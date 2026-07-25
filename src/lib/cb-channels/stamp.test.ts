import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  stampMessageChannel,
  followConversationChannel,
  pinConversationChannel,
} from './stamp';

// Mock de UPDATE: `.update(payload).eq(col,val)...` é aguardável (thenable) e
// resolve { error }. Registra cada update aplicado (tabela, payload, filtros).
function makeDb(result: { error?: unknown } = {}) {
  const calls: Array<{
    table: string;
    payload: unknown;
    filters: Record<string, unknown>;
  }> = [];
  const db = {
    calls,
    from(table: string) {
      let payload: unknown;
      const filters: Record<string, unknown> = {};
      let recorded = false;
      const builder: Record<string, unknown> = {
        update: (p: unknown) => {
          payload = p;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        then: (resolve: (v: { error: unknown }) => void) => {
          if (!recorded) {
            calls.push({ table, payload, filters });
            recorded = true;
          }
          resolve({ error: result.error ?? null });
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient & { calls: typeof calls };
}

afterEach(() => vi.restoreAllMocks());

describe('stampMessageChannel', () => {
  it('channelId null → no-op (nenhum update)', async () => {
    const db = makeDb();
    await stampMessageChannel(db, 'm1', null);
    expect(db.calls).toHaveLength(0);
  });

  it('channelId presente → UPDATE messages SET channel_id WHERE id', async () => {
    const db = makeDb();
    await stampMessageChannel(db, 'm1', 'ch1');
    expect(db.calls).toEqual([
      { table: 'messages', payload: { channel_id: 'ch1' }, filters: { id: 'm1' } },
    ]);
  });

  it('erro no update (coluna ausente pré-migration) → engolido, não lança', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({ error: { message: 'column channel_id does not exist' } });
    await expect(stampMessageChannel(db, 'm1', 'ch1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('followConversationChannel', () => {
  it('channelId null → no-op (não sobrescreve com nada)', async () => {
    const db = makeDb();
    await followConversationChannel(db, 'c1', null);
    expect(db.calls).toHaveLength(0);
  });

  it('channelId presente → UPDATE conversations com guarda channel_pinned = false', async () => {
    const db = makeDb();
    await followConversationChannel(db, 'c1', 'ch1');
    expect(db.calls).toEqual([
      {
        table: 'conversations',
        payload: { channel_id: 'ch1' },
        filters: { id: 'c1', channel_pinned: false },
      },
    ]);
  });

  it('erro no update → engolido, não lança', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const db = makeDb({ error: { message: 'column channel_pinned does not exist' } });
    await expect(followConversationChannel(db, 'c1', 'ch1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

// ------------------------------------------------------------
// pinConversationChannel valida a POSSE do canal antes de gravar: o
// channel_id vem de request externo (API pública, seletor do inbox) e não
// pode apontar para canal de outra conta. Estes testes miram exatamente isso.
// ------------------------------------------------------------
function makeDbComLookup(opts: {
  canalEncontrado: boolean;
  updateError?: unknown;
  lookupError?: unknown;
}) {
  const calls: Array<{
    table: string;
    payload: unknown;
    filters: Record<string, unknown>;
  }> = [];
  const db = {
    calls,
    from(table: string) {
      let payload: unknown;
      const filters: Record<string, unknown> = {};
      let recorded = false;
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (p: unknown) => {
          payload = p;
          return builder;
        },
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: () =>
          Promise.resolve({
            data: opts.canalEncontrado ? { id: 'ch-1' } : null,
            error: opts.lookupError ?? null,
          }),
        then: (resolve: (v: { error: unknown }) => void) => {
          if (!recorded) {
            calls.push({ table, payload, filters });
            recorded = true;
          }
          resolve({ error: opts.updateError ?? null });
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient & { calls: typeof calls };
}

describe('pinConversationChannel', () => {
  it('fixa o canal e marca channel_pinned quando o canal é da conta', async () => {
    const db = makeDbComLookup({ canalEncontrado: true });
    const ok = await pinConversationChannel(db, 'acct', 'conv-1', 'ch-1');
    expect(ok).toBe(true);

    const update = db.calls.find((c) => c.table === 'conversations');
    expect(update?.payload).toEqual({
      channel_id: 'ch-1',
      channel_pinned: true,
    });
    // Escopo de tenancy no próprio UPDATE, não só no lookup.
    expect(update?.filters).toMatchObject({ id: 'conv-1', account_id: 'acct' });
  });

  it('recusa canal de OUTRA conta sem escrever nada', async () => {
    const db = makeDbComLookup({ canalEncontrado: false });
    const ok = await pinConversationChannel(db, 'acct', 'conv-1', 'ch-alheio');
    expect(ok).toBe(false);
    expect(db.calls.find((c) => c.table === 'conversations')).toBeUndefined();
  });

  it('devolve false quando o UPDATE falha, em vez de mentir sucesso', async () => {
    const db = makeDbComLookup({
      canalEncontrado: true,
      updateError: { message: 'boom' },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await pinConversationChannel(db, 'acct', 'conv-1', 'ch-1')).toBe(false);
  });
});
