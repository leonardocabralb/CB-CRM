import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,

      instagram_id: null,

      instagram_username: null,

      whatsapp_user_id: null,
      whatsapp_username: null,

      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('expõe o BSUID e o @ do WhatsApp, só leitura (Fase 11, decisão 5)', () => {
    // A ficha que a Meta manda só com o nome de usuário não tem telefone: sem
    // estes dois campos o integrador recebia `phone: null` sem identificador.
    const ct = serializeContact({
      id: 'c3',
      phone: null,
      name: null,
      wa_user_id: 'BR.1349120865530274',
      wa_username: 'ana.silva',
      wa_parent_user_id: 'BR.ENT.1181579921288684',
      created_at: 'a',
      updated_at: 'b',
    });
    expect(ct.whatsapp_user_id).toBe('BR.1349120865530274');
    expect(ct.whatsapp_username).toBe('ana.silva');
    // O do portfólio não é identidade da pessoa: não sai.
    expect(JSON.stringify(ct)).not.toContain('ENT');
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a phone outside the rule with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });
});

// ============================================================
// Fase 3-III do merge do upstream: o `phone` do integrador passa pela régua
// das telas (`telefoneDigitado`), com a frase do motivo.
// ============================================================
describe('findOrCreateContact: o telefone passa pela régua', () => {
  const noopDb = {
    from() {
      throw new Error('should not query');
    },
  } as unknown as SupabaseClient;

  it.each([
    ['sem DDD', '98874-5316', "'phone' is too short"],
    ['0 de tronco', '081 98874-5316', "'phone' is not a valid phone number"],
    ['JID colado', '5581988745316@s.whatsapp.net', "'phone' is not a valid phone number"],
    ['LID', '123456789012345@lid', "'phone' is not a valid phone number"],
    ['mais de 15 dígitos', '+1204360400000000000', "'phone' is not a valid phone number"],
  ])('%s → 400 antes de qualquer consulta', async (_caso, phone, frase) => {
    const erro = await findOrCreateContact(noopDb, 'acc', 'user', { phone }).catch(
      (e: unknown) => e
    );
    expect(erro).toBeInstanceOf(ContactError);
    expect((erro as ContactError).status).toBe(400);
    expect((erro as ContactError).message).toContain(frase);
  });

  it.each([
    ['(81) 98874-5316', '5581988745316'],
    ['81 3456-7890', '558134567890'],
    ['+1 415 555 0123', '14155550123'],
    ['5581988745316', '5581988745316'],
  ])('%s é gravado como %s', async (phone, esperado) => {
    const inseridos: Record<string, unknown>[] = [];
    const cadeia: Record<string, unknown> = {
      select: () => cadeia,
      eq: () => cadeia,
      order: () => cadeia,
      like: () => Promise.resolve({ data: [], error: null }),
      insert: (linha: Record<string, unknown>) => {
        inseridos.push(linha);
        return cadeia;
      },
      single: () => Promise.resolve({ data: { id: 'novo' }, error: null }),
    };
    const db = { from: () => cadeia } as unknown as SupabaseClient;

    const r = await findOrCreateContact(db, 'acc', 'user', { phone });

    expect(r).toEqual({ id: 'novo', created: true });
    expect(inseridos).toHaveLength(1);
    expect(inseridos[0]).toMatchObject({ phone: esperado, name: esperado });
  });
});
