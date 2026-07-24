import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveInboundEvolutionChannel,
  resolveInboundMetaChannelId,
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

describe('resolveInboundEvolutionChannel', () => {
  it('canal em cb_channels com created_by → usa a conta e o dono do canal (sem tocar whatsapp_config)', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'ch1', account_id: 'acc1', created_by: 'user1' },
      }),
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-abc');
    expect(route).toEqual({
      accountId: 'acc1',
      ownerUserId: 'user1',
      channelId: 'ch1',
    });
    // Não consultou whatsapp_config: created_by resolveu o dono.
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels']);
  });

  it('canal em cb_channels com created_by NULL → cai para whatsapp_config.user_id da conta', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'ch1', account_id: 'acc1', created_by: null },
      }),
      whatsapp_config: (f) =>
        f.account_id === 'acc1' ? { data: { user_id: 'owner2' } } : { data: null },
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-abc');
    expect(route).toEqual({
      accountId: 'acc1',
      ownerUserId: 'owner2',
      channelId: 'ch1',
    });
    // Consultou cb_channels e depois whatsapp_config por account_id.
    expect(db.calls.map((c) => c.table)).toEqual(['cb_channels', 'whatsapp_config']);
    expect(db.calls[1].filters).toMatchObject({ account_id: 'acc1' });
  });

  it('sem canal em cb_channels → fallback whatsapp_config por instance_name, channelId NULL', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null }),
      whatsapp_config: (f) =>
        f.instance_name === 'cbcrm-gabriel' && f.provider === 'evolution'
          ? { data: { account_id: 'accG', user_id: 'userG' } }
          : { data: null },
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-gabriel');
    expect(route).toEqual({
      accountId: 'accG',
      ownerUserId: 'userG',
      channelId: null,
    });
  });

  it('cb_channels com erro (tabela ausente pré-migration) → ignora o erro e usa o fallback', async () => {
    const db = makeDb({
      cb_channels: () => ({
        data: null,
        error: { message: 'relation "cb_channels" does not exist' },
      }),
      whatsapp_config: () => ({ data: { account_id: 'accG', user_id: 'userG' } }),
    });
    const route = await resolveInboundEvolutionChannel(db, 'cbcrm-gabriel');
    expect(route).toEqual({
      accountId: 'accG',
      ownerUserId: 'userG',
      channelId: null,
    });
  });

  it('instância desconhecida (nem canal, nem whatsapp_config) → null', async () => {
    const db = makeDb({
      cb_channels: () => ({ data: null }),
      whatsapp_config: () => ({ data: null }),
    });
    expect(await resolveInboundEvolutionChannel(db, 'desconhecida')).toBeNull();
  });

  it('canal sem dono resolvível (created_by e whatsapp_config nulos) → null e loga erro', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const db = makeDb({
      cb_channels: () => ({
        data: { id: 'ch1', account_id: 'acc1', created_by: null },
      }),
      whatsapp_config: () => ({ data: null }),
    });
    expect(await resolveInboundEvolutionChannel(db, 'cbcrm-acc1-x')).toBeNull();
    expect(err).toHaveBeenCalled();
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
