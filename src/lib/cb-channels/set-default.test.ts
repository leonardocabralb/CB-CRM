import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { setDefaultChannel } from './set-default';

// ------------------------------------------------------------
// Stub do Supabase que REGISTRA o que foi escrito. O ponto destes testes
// não é só "deu ok": é conferir que o espelho whatsapp_config recebeu o
// provider certo e que as colunas do outro tipo foram zeradas — é aí que
// mora o drift silencioso entre o painel e o que o envio usa.
// ------------------------------------------------------------
type Canal = Record<string, unknown> | null;

interface Registro {
  /** UPDATEs em cb_channels, na ordem. */
  updates: { payload: Record<string, unknown>; filtros: string[] }[];
  /** Linha entregue ao upsert de whatsapp_config. */
  mirror: Record<string, unknown> | null;
}

function makeDb(
  canal: Canal,
  opts: { mirrorError?: { message: string }; updateError?: { message: string } } = {},
): { db: SupabaseClient; reg: Registro } {
  const reg: Registro = { updates: [], mirror: null };
  let table = '';

  const builder: Record<string, unknown> = {
    select: () => builder,
    update: (payload: Record<string, unknown>) => {
      const filtros: string[] = [];
      const chain: Record<string, unknown> = {
        eq: (col: string) => {
          filtros.push(col);
          return chain;
        },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'cb_channels') reg.updates.push({ payload, filtros });
          return resolve({ data: null, error: opts.updateError ?? null });
        },
      };
      return chain;
    },
    upsert: (row: Record<string, unknown>) => {
      reg.mirror = row;
      return Promise.resolve({ data: null, error: opts.mirrorError ?? null });
    },
    eq: () => builder,
    maybeSingle: () => Promise.resolve({ data: canal, error: null }),
  };

  const db = {
    from: (t: string) => {
      table = t;
      return builder;
    },
  } as unknown as SupabaseClient;

  return { db, reg };
}

const META = {
  id: 'ch-meta',
  account_id: 'acct',
  kind: 'meta',
  label: 'Comercial',
  is_default: false,
  status: 'connected',
  connected_at: '2026-07-01T00:00:00Z',
  phone_number_id: 'pni-1',
  waba_id: 'waba-1',
  access_token: 'enc-token',
  verify_token: 'enc-verify',
  server_url: null,
  instance_name: null,
  api_key: null,
};

const EVOLUTION = {
  id: 'ch-evo',
  account_id: 'acct',
  kind: 'evolution',
  label: 'Dr. Leonardo',
  is_default: false,
  status: 'connected',
  connected_at: '2026-07-02T00:00:00Z',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
  verify_token: null,
  server_url: 'https://evo.example.com',
  instance_name: 'inst-1',
  api_key: 'enc-key',
};

describe('setDefaultChannel', () => {
  it('404 quando o canal não existe na conta', async () => {
    const { db } = makeDb(null);
    const r = await setDefaultChannel(db, 'acct', 'user', 'sumiu');
    expect(r).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('recusa canal Meta sem access_token em vez de gravar espelho inválido', async () => {
    // O CHECK whatsapp_config_provider_fields_check exige phone_number_id E
    // access_token quando provider='meta'. Promover assim estouraria no banco.
    const { db, reg } = makeDb({ ...META, access_token: null });
    const r = await setDefaultChannel(db, 'acct', 'user', 'ch-meta');
    expect(r).toMatchObject({ ok: false, code: 'incomplete' });
    expect(reg.updates).toHaveLength(0);
    expect(reg.mirror).toBeNull();
  });

  it('recusa canal Evolution sem api_key', async () => {
    const { db } = makeDb({ ...EVOLUTION, api_key: null });
    const r = await setDefaultChannel(db, 'acct', 'user', 'ch-evo');
    expect(r).toMatchObject({ ok: false, code: 'incomplete' });
  });

  it('limpa o padrão antigo ANTES de marcar o novo (índice único parcial)', async () => {
    // cb_channels_one_default_idx é UNIQUE parcial sobre (account_id) WHERE
    // is_default. Marcar o novo primeiro violaria o índice.
    const { db, reg } = makeDb(META);
    const r = await setDefaultChannel(db, 'acct', 'user', 'ch-meta');
    expect(r.ok).toBe(true);
    expect(reg.updates).toHaveLength(2);
    expect(reg.updates[0].payload).toEqual({ is_default: false });
    expect(reg.updates[1].payload).toEqual({ is_default: true });
  });

  it('promover canal Meta escreve o espelho como meta e zera o lado Evolution', async () => {
    const { db, reg } = makeDb(META);
    await setDefaultChannel(db, 'acct', 'user', 'ch-meta');
    expect(reg.mirror).toMatchObject({
      account_id: 'acct',
      provider: 'meta',
      phone_number_id: 'pni-1',
      waba_id: 'waba-1',
      access_token: 'enc-token',
      status: 'connected',
      // sem isto, resolve-inbound poderia casar um instance_name órfão
      base_url: null,
      instance_name: null,
      api_key: null,
    });
  });

  it('promover canal Evolution zera phone_number_id (tem índice único global)', async () => {
    // Deixar o phone_number_id antigo no espelho impediria outra conta de
    // cadastrar aquele mesmo número.
    const { db, reg } = makeDb(EVOLUTION);
    await setDefaultChannel(db, 'acct', 'user', 'ch-evo');
    expect(reg.mirror).toMatchObject({
      provider: 'evolution',
      base_url: 'https://evo.example.com',
      instance_name: 'inst-1',
      api_key: 'enc-key',
      instance_state: 'open',
      phone_number_id: null,
      access_token: null,
    });
  });

  it('é idempotente: promover quem já é padrão só ressincroniza o espelho', async () => {
    // Caminho de recuperação de uma promoção que falhou no meio.
    const { db, reg } = makeDb({ ...META, is_default: true });
    const r = await setDefaultChannel(db, 'acct', 'user', 'ch-meta');
    expect(r).toMatchObject({ ok: true, alreadyDefault: true });
    expect(reg.updates).toHaveLength(0);
    expect(reg.mirror).toMatchObject({ provider: 'meta' });
  });

  it('falha do espelho devolve aviso, não erro — o canal já foi promovido', async () => {
    const { db } = makeDb(META, { mirrorError: { message: 'boom' } });
    const r = await setDefaultChannel(db, 'acct', 'user', 'ch-meta');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mirrorWarning).toContain('espelho');
  });
});
