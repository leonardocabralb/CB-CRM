import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveEngineChannel,
  evolutionTransportFor,
  evolutionRemoteJid,
} from './engine-send';
import type { ResolvedChannel } from './resolve';

// Mock que respeita tabela + filtros (mesmo padrão de resolve-inbound.test.ts):
// cada tabela recebe um handler que vê os `.eq()` acumulados. `single` e
// `maybeSingle` compartilham o handler — resolve.ts usa os dois.
type Handler = (filters: Record<string, unknown>) => {
  data?: unknown;
  error?: unknown;
};

function makeDb(handlers: Record<string, Handler>) {
  const db = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const resolve = () => {
        const res = handlers[table]?.(filters) ?? { data: null };
        return Promise.resolve({ data: res.data ?? null, error: res.error ?? null });
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return builder;
        },
        maybeSingle: resolve,
        single: resolve,
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const CH_EVO = {
  id: 'ch-evo',
  kind: 'evolution',
  phone_number_id: null,
  waba_id: null,
  access_token: null,
  server_url: 'https://evo.example.com',
  instance_name: 'cbcrm-acc1-x',
  api_key: 'enc-key',
};

describe('resolveEngineChannel', () => {
  it('conversa com channel_id → resolve o canal fixado/seguido', async () => {
    const db = makeDb({
      conversations: (f) =>
        f.id === 'conv1' && f.account_id === 'acc1'
          ? { data: { channel_id: 'ch-evo' } }
          : { data: null },
      cb_channels: (f) => (f.id === 'ch-evo' ? { data: CH_EVO } : { data: null }),
    });
    const ch = await resolveEngineChannel(db, 'acc1', 'conv1');
    expect(ch?.provider).toBe('evolution');
    expect(ch?.channelId).toBe('ch-evo');
    expect(ch?.instance_name).toBe('cbcrm-acc1-x');
  });

  it('erro na leitura da conversa (pré-902, coluna ausente) → cai no canal padrão', async () => {
    const db = makeDb({
      conversations: () => ({
        data: null,
        error: { message: 'column conversations.channel_id does not exist' },
      }),
      cb_channels: (f) =>
        f.is_default === true && f.account_id === 'acc1'
          ? { data: { ...CH_EVO, id: 'ch-default' } }
          : { data: null },
    });
    const ch = await resolveEngineChannel(db, 'acc1', 'conv1');
    expect(ch?.channelId).toBe('ch-default');
  });

  it('sem canais e sem whatsapp_config → null', async () => {
    const db = makeDb({
      conversations: () => ({ data: null }),
      cb_channels: () => ({ data: null }),
      whatsapp_config: () => ({ data: null }),
    });
    expect(await resolveEngineChannel(db, 'acc1', 'conv1')).toBeNull();
  });
});

describe('evolutionTransportFor', () => {
  it('canal incompleto (sem api_key) → lança mensagem clara', () => {
    const channel = {
      provider: 'evolution',
      base_url: 'https://evo.example.com',
      instance_name: 'cbcrm-acc1-x',
      api_key: null,
    } as unknown as ResolvedChannel;
    expect(() => evolutionTransportFor(channel)).toThrow(/incomplete/);
  });
});

describe('evolutionRemoteJid', () => {
  it('monta o JID a partir do E.164', () => {
    expect(evolutionRemoteJid('+5511999999999')).toBe(
      '5511999999999@s.whatsapp.net',
    );
  });
});
