import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  donoDaConta,
  resolveInboundEvolutionChannel,
  resolveInboundInstagramChannel,
  resolveInboundMetaChannelId,
  resolveInboundMetaChannel,
} from './resolve-inbound';

// Mock que RESPEITA tabela + filtros: cada tabela recebe um handler que vê os
// `.eq()` acumulados e devolve { data, error }. Registra as consultas para
// afirmar a ORDEM de resolução (o que o mock antigo do resolve.test.ts não
// fazia — ver revisão das Fases 0-2).
type Handler = (filters: Record<string, unknown>) => {
  data?: unknown;
  error?: unknown;
};

function makeDb(handlers: Record<string, Handler>) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const db = {
    calls,
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () => {
          calls.push({ table, filters });
          const res = handlers[table]?.(filters) ?? { data: null };
          return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient & { calls: typeof calls };
}

afterEach(() => vi.restoreAllMocks());

// O dono DURÁVEL de cada conta dos testes (`accounts.owner_user_id`). Quem
// conectou o número (`created_by`, `whatsapp_config.user_id`) aparece nos
// dados de propósito, sempre DIFERENTE do dono: é o que prova que ele não é
// lido.
const DONOS: Record<string, string> = { acc1: 'dono1', accG: 'donoG' };
const accounts: Handler = (f) => ({ data: { owner_user_id: DONOS[f.id as string] ?? null } });

describe('resolveInboundEvolutionChannel', () => {
  it('canal em cb_channels → a conta do canal e o DONO DA CONTA, nunca quem conectou', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'ch1', account_id: 'acc1', created_by: 'membro-que-conectou' },
      }),
      accounts,
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-abc');
    expect(route).toEqual({
      accountId: 'acc1',
      ownerUserId: 'dono1',
      channelId: 'ch1',
      // Coluna ausente/nula = grupos DESLIGADOS. O padrão seguro importa:
      // ligado por omissão despejaria todos os grupos do número no inbox no
      // primeiro deploy (906).
      groupsEnabled: false,
      ownLid: null,
    });
    // O dono sai de `accounts`, pelo id da conta — e `whatsapp_config` não é
    // consultado.
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels', 'accounts']);
    expect(db.calls[1].filters).toEqual({ id: 'acc1' });
  });

  it('sem canal em cb_channels → fallback whatsapp_config por instance_name, channelId NULL, dono da conta', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null }),
      whatsapp_config: (f) =>
        f.instance_name === 'cbcrm-gabriel' && f.provider === 'evolution'
          ? { data: { account_id: 'accG', user_id: 'quem-conectou' } }
          : { data: null },
      accounts,
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-gabriel');
    expect(route).toEqual({
      accountId: 'accG',
      ownerUserId: 'donoG',
      channelId: null,
      groupsEnabled: false,
      ownLid: null,
    });
  });

  it('cb_channels com erro (tabela ausente pré-migration) → ignora o erro e usa o fallback', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: null,
        error: { message: 'relation "cb_channels" does not exist' },
      }),
      whatsapp_config: () => ({ data: { account_id: 'accG', user_id: 'quem-conectou' } }),
      accounts,
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-gabriel');
    expect(route).toEqual({
      accountId: 'accG',
      ownerUserId: 'donoG',
      channelId: null,
      groupsEnabled: false,
      ownLid: null,
    });
  });

  it('canal com grupos LIGADOS propaga o interruptor e o nosso lid', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: {
          id: 'ch1',
          account_id: 'acc1',
          groups_enabled: true,
          own_lid: '1438000009152@lid',
        },
      }),
      accounts,
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-abc');
    expect(route).toMatchObject({
      ownerUserId: 'dono1',
      groupsEnabled: true,
      ownLid: '1438000009152@lid',
    });
  });

  it('instância desconhecida (nem canal, nem whatsapp_config) → null', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null }),
      whatsapp_config: () => ({ data: null }),
      accounts,
    });
    expect(await resolveInboundEvolutionChannel(db, 'desconhecida')).toBeNull();
  });

  it('a leitura do dono que FALHA é repetida uma vez — e a segunda resolve', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let vezes = 0;
    const db = makeDb({
      cb_channels: () => ({ data: { id: 'ch1', account_id: 'acc1' } }),
      accounts: (f) => (++vezes === 1 ? { error: { message: 'timeout' } } : accounts(f)),
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-abc');
    expect(route?.ownerUserId).toBe('dono1');
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels', 'accounts', 'accounts']);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('dono irresolvível (duas falhas) → null e log; NUNCA cai para quem conectou', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'ch1', account_id: 'acc1', created_by: 'membro-que-conectou' },
      }),
      whatsapp_config: () => ({ data: { user_id: 'quem-conectou' } }),
      accounts: () => ({ error: { message: 'timeout' } }),
    });
    expect(await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-x')).toBeNull();
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels', 'accounts', 'accounts']);
    expect(err).toHaveBeenCalled();
  });
});

describe('donoDaConta', () => {
  it('conta sem linha → null, sem repetir (não é falha de leitura)', async () => {
    const db = makeDb({ accounts: () => ({ data: null }) });
    expect(await donoDaConta(db, 'acc-x')).toBeNull();
    expect(db.calls).toHaveLength(1);
  });
});

describe('resolveInboundMetaChannelId', () => {
  it('devolve o id do canal Meta que atende o phone_number_id', async () => {
    const db = makeDb({
      cb_channels: (f) =>
        f.phone_number_id === 'pn1' && f.kind === 'meta'
          ? { data: { id: 'chm' } }
          : { data: null },
    });
    expect(await resolveInboundMetaChannelId(db, 'pn1')).toBe('chm');
  });

  it('sem canal → null', async () => {
    const db = makeDb({ cb_channels: () => ({ data: null }) });
    expect(await resolveInboundMetaChannelId(db, 'pn1')).toBeNull();
  });

  it('erro na consulta (tabela ausente) → null (engolido)', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null, error: { message: 'does not exist' } }),
    });
    expect(await resolveInboundMetaChannelId(db, 'pn1')).toBeNull();
  });
});

describe('resolveInboundMetaChannel', () => {
  it('canal Meta com token → devolve conta / DONO DA CONTA / token(cripto) / canal', async () => {
    const db = makeDb({
      cb_channels: (f) =>
        f.phone_number_id === 'pn1' && f.kind === 'meta'
          ? {
              data: {
                id: 'chm',
                account_id: 'acc1',
                created_by: 'membro-que-conectou',
                access_token: 'enc-token',
              },
            }
          : { data: null },
      accounts,
    });
    expect(await resolveInboundMetaChannel(db, 'pn1')).toEqual({
      accountId: 'acc1',
      ownerUserId: 'dono1',
      accessToken: 'enc-token',
      channelId: 'chm',
    });
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels', 'accounts']);
  });

  it('dono irresolvível → null e log; NUNCA cai para quem conectou nem para whatsapp_config', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'chm', account_id: 'acc1', created_by: 'u', access_token: 'enc-token' },
      }),
      whatsapp_config: () => ({ data: { user_id: 'quem-conectou' } }),
      accounts: () => ({ error: { message: 'timeout' } }),
    });
    expect(await resolveInboundMetaChannel(db, 'pn1')).toBeNull();
    expect(db.calls.map((c) => c.table)).not.toContain('whatsapp_config');
    expect(err).toHaveBeenCalled();
  });

  it('canal sem access_token → null (não dá para receber sem token)', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'chm', account_id: 'acc1', access_token: null },
      }),
      accounts,
    });
    expect(await resolveInboundMetaChannel(db, 'pn1')).toBeNull();
  });

  it('sem canal → null', async () => {
    const db = makeDb({ cb_channels: () => ({ data: null }) });
    expect(await resolveInboundMetaChannel(db, 'pn1')).toBeNull();
  });

  it('erro na consulta (tabela ausente pré-901) → null (engolido)', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null, error: { message: 'does not exist' } }),
    });
    expect(await resolveInboundMetaChannel(db, 'pn1')).toBeNull();
  });
});

describe('resolveInboundInstagramChannel', () => {
  it('a conexão do Instagram usa o mesmo dono da conta (e a mesma repetição)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let vezes = 0;
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'chi', account_id: 'acc1', ig_app_secret: 'enc-s', access_token: null },
      }),
      accounts: (f) => (++vezes === 1 ? { error: { message: 'timeout' } } : accounts(f)),
    });
    expect(await resolveInboundInstagramChannel(db, 'ig1')).toEqual({
      accountId: 'acc1',
      ownerUserId: 'dono1',
      channelId: 'chi',
      igAppSecretCifrado: 'enc-s',
      accessTokenCifrado: null,
    });
    expect(err).toHaveBeenCalledTimes(1);
  });
});
