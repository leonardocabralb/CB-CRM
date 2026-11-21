import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { MetaApiError } from '@/lib/whatsapp/meta-api';
import {
  desfechoDaFalha,
  falhaDaMontagem,
  gravarDesfechoDaReserva,
  reservarDestinatario,
} from './broadcast-entrega';
import type { MessageTemplate } from '@/types';

// ============================================================
// NOSSO (1151): a entrega do disparo, linha a linha — reservar ANTES da Meta
// (`uncertain`), gravar o desfecho cercado pela reserva, e só a recusa
// COMPROVADA (4xx) é `failed`.
// ============================================================

type Update = { patch: Record<string, unknown>; filtros: [string, unknown][] };

function bancoFalso(resposta: { data?: unknown[] | null; error?: unknown; lanca?: boolean } = {}) {
  const updates: Update[] = [];
  const db = {
    from(tabela: string) {
      expect(tabela).toBe('broadcast_recipients');
      return {
        update(patch: Record<string, unknown>) {
          const u: Update = { patch, filtros: [] };
          updates.push(u);
          const q = {
            eq(k: string, v: unknown) {
              u.filtros.push([k, v]);
              return q;
            },
            in(k: string, v: unknown) {
              u.filtros.push([`${k} in`, v]);
              return q;
            },
            async select() {
              if (resposta.lanca) throw new Error('rede');
              return { data: 'data' in resposta ? resposta.data : [{ id: 'x' }], error: resposta.error ?? null };
            },
          };
          return q;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, updates };
}

describe('reservarDestinatario', () => {
  it('passa a linha a `uncertain` só da situação pedida (padrão: `pending`)', async () => {
    const { db, updates } = bancoFalso();
    expect(await reservarDestinatario(db, 'r1')).toBe('reservada');
    expect(updates).toEqual([
      {
        patch: { status: 'uncertain', error_message: null },
        filtros: [
          ['id', 'r1'],
          ['status in', ['pending']],
        ],
      },
    ]);
    const outro = bancoFalso();
    await reservarDestinatario(outro.db, 'r1', ['pending', 'failed']);
    expect(outro.updates[0].filtros[1]).toEqual(['status in', ['pending', 'failed']]);
  });

  it('⚠️⚠️ 0 linhas = `ocupada` (outra mão a tem, ou já saiu); erro ou exceção = `erro` — nos dois, não manda', async () => {
    expect(await reservarDestinatario(bancoFalso({ data: [] }).db, 'r1')).toBe('ocupada');
    expect(await reservarDestinatario(bancoFalso({ data: null, error: { message: 'x' } }).db, 'r1')).toBe('erro');
    expect(await reservarDestinatario(bancoFalso({ lanca: true }).db, 'r1')).toBe('erro');
  });
});

describe('gravarDesfechoDaReserva', () => {
  it('cada desfecho, sempre cercado pela reserva (`uncertain`)', async () => {
    const { db, updates } = bancoFalso();
    await gravarDesfechoDaReserva(db, 'r1', { status: 'sent', whatsappMessageId: 'wamid.1' });
    await gravarDesfechoDaReserva(db, 'r1', { status: 'failed', erro: 'recusado' });
    await gravarDesfechoDaReserva(db, 'r1', { status: 'uncertain', erro: 'sem resposta' });
    expect(updates[0].patch).toMatchObject({ status: 'sent', whatsapp_message_id: 'wamid.1', error_message: null });
    expect(typeof updates[0].patch.sent_at).toBe('string');
    expect(updates[1].patch).toEqual({ status: 'failed', error_message: 'recusado' });
    // A incerta já está incerta desde a reserva: só o motivo.
    expect(updates[2].patch).toEqual({ error_message: 'sem resposta' });
    for (const u of updates) {
      expect(u.filtros).toEqual([
        ['id', 'r1'],
        ['status', 'uncertain'],
      ]);
    }
  });

  it('não gravou (0 linhas, erro, exceção): `false`, sem lançar', async () => {
    const desfecho = { status: 'sent', whatsappMessageId: 'w' } as const;
    expect(await gravarDesfechoDaReserva(bancoFalso({ data: [] }).db, 'r1', desfecho)).toBe(false);
    expect(await gravarDesfechoDaReserva(bancoFalso({ data: null, error: { message: 'x' } }).db, 'r1', desfecho)).toBe(false);
    expect(await gravarDesfechoDaReserva(bancoFalso({ lanca: true }).db, 'r1', desfecho)).toBe(false);
    expect(await gravarDesfechoDaReserva(bancoFalso().db, 'r1', desfecho)).toBe(true);
  });
});

describe('desfechoDaFalha', () => {
  it('⚠️⚠️ só o 4xx da Meta é recusa comprovada; 5xx, rede e o resto podem ter saído', () => {
    expect(desfechoDaFalha(new MetaApiError('recusado', { httpStatus: 400, code: 131026 }))).toBe('failed');
    expect(desfechoDaFalha(new MetaApiError('limite', { httpStatus: 429 }))).toBe('failed');
    expect(desfechoDaFalha(new MetaApiError('fora', { httpStatus: 500 }))).toBe('uncertain');
    expect(desfechoDaFalha(new MetaApiError('fora', { httpStatus: 503 }))).toBe('uncertain');
    expect(desfechoDaFalha(new TypeError('fetch failed'))).toBe('uncertain');
    expect(desfechoDaFalha(new Error('qualquer coisa'))).toBe('uncertain');
  });
});

describe('falhaDaMontagem', () => {
  const modelo = (extra: Record<string, unknown>) =>
    ({ name: 'm', language: 'pt_BR', body_text: 'Olá {{1}}', buttons: [], ...extra }) as unknown as MessageTemplate;

  it('sem linha local do modelo, nada a conferir', () => {
    expect(falhaDaMontagem(null, [])).toBeNull();
    expect(falhaDaMontagem(undefined, [])).toBeNull();
  });

  it('monta como `sendTemplateMessage`: o modelo que monta passa', () => {
    expect(falhaDaMontagem(modelo({}), ['Ana'])).toBeNull();
    // A mídia do cabeçalho pela troca de `messageParams`, como no envio.
    expect(
      falhaDaMontagem(modelo({ header_type: 'image', header_media_url: null }), ['Ana'], {
        headerMediaUrl: 'https://exemplo.test/a.png',
      }),
    ).toBeNull();
  });

  it('o que não monta devolve o motivo (e nunca chega à Meta)', () => {
    expect(
      falhaDaMontagem(modelo({ header_type: 'image', header_media_url: null }), ['Ana']),
    ).toMatch(/image header requires a media link or id/);
  });
});
