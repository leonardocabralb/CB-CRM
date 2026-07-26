import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveMetaChannel } from './resolve-meta';

// ------------------------------------------------------------
// Broadcast e modelos NÃO passam por uma conversa, então liam o espelho
// `whatsapp_config` e perguntavam "o canal PADRÃO é Meta?". Em produção o
// padrão é Evolution — então o operador conectava o número oficial e mesmo
// assim recebia "Broadcasts require an official Meta (Cloud API) number".
// A pergunta certa é "EXISTE um canal Meta utilizável?".
// ------------------------------------------------------------

const META = {
  id: 'ch-meta',
  label: 'Comercial',
  kind: 'meta',
  is_default: false,
  status: 'connected',
  phone_number_id: 'pni-1',
  waba_id: 'waba-1',
  access_token: 'enc',
};
const EVO = {
  id: 'ch-evo',
  label: 'Dr. Leonardo',
  kind: 'evolution',
  is_default: true,
  status: 'connected',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
};

function makeDb(opts: {
  canais?: Record<string, unknown>[];
  porId?: Record<string, unknown> | null;
  espelho?: Record<string, unknown> | null;
  erroCanais?: { message: string } | null;
}): SupabaseClient {
  let table = '';
  let filtrouId = false;

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string) => {
      if (col === 'id') filtrouId = true;
      return builder;
    },
    order: () => builder,
    maybeSingle: () => {
      if (table === 'cb_channels') {
        return Promise.resolve({ data: opts.porId ?? null, error: null });
      }
      return Promise.resolve({ data: opts.espelho ?? null, error: null });
    },
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: filtrouId ? null : (opts.canais ?? []),
        error: opts.erroCanais ?? null,
      }),
  };

  return {
    from: (t: string) => {
      table = t;
      filtrouId = false;
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('resolveMetaChannel', () => {
  it('acha o canal Meta mesmo quando o PADRÃO é Evolution', async () => {
    // O cenário exato de produção — e a razão de todo o conserto.
    const r = await resolveMetaChannel(makeDb({ canais: [EVO, META] }), 'acct');
    expect(r?.channelId).toBe('ch-meta');
    expect(r?.phoneNumberId).toBe('pni-1');
  });

  it('prefere o canal CONECTADO a um Meta desconectado', async () => {
    const desconectado = { ...META, id: 'ch-off', status: 'disconnected' };
    const r = await resolveMetaChannel(
      makeDb({ canais: [desconectado, META] }),
      'acct',
    );
    expect(r?.channelId).toBe('ch-meta');
  });

  it('ignora canal Meta sem credencial', async () => {
    const incompleto = { ...META, access_token: null };
    const r = await resolveMetaChannel(makeDb({ canais: [incompleto] }), 'acct');
    expect(r).toBeNull();
  });

  it('canal pedido explicitamente é usado', async () => {
    const r = await resolveMetaChannel(makeDb({ porId: META }), 'acct', 'ch-meta');
    expect(r?.channelId).toBe('ch-meta');
  });

  it('canal pedido que NÃO é Meta devolve null — não cai no padrão', async () => {
    // Quem pediu um número específico prefere um erro a ver a campanha sair
    // pelo número errado.
    const r = await resolveMetaChannel(makeDb({ porId: EVO }), 'acct', 'ch-evo');
    expect(r).toBeNull();
  });

  it('canal pedido de outra conta devolve null', async () => {
    const r = await resolveMetaChannel(makeDb({ porId: null }), 'acct', 'ch-alheio');
    expect(r).toBeNull();
  });

  it('cai no espelho legado quando a conta nunca criou canais', async () => {
    const r = await resolveMetaChannel(
      makeDb({
        canais: [],
        espelho: {
          provider: 'meta',
          phone_number_id: 'pni-legado',
          waba_id: 'waba-legado',
          access_token: 'enc',
        },
      }),
      'acct',
    );
    expect(r?.channelId).toBeNull();
    expect(r?.phoneNumberId).toBe('pni-legado');
  });

  it('espelho Evolution não vale como canal Meta', async () => {
    const r = await resolveMetaChannel(
      makeDb({
        canais: [],
        espelho: { provider: 'evolution', phone_number_id: null, access_token: null },
      }),
      'acct',
    );
    expect(r).toBeNull();
  });
});
