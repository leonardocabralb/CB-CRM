import { describe, it, expect, vi, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { stampMessageChannel, followConversationChannel } from './stamp';

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
