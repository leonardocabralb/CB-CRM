import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  resolveEngineChannel,
  resolveEngineChannelPreferring,
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

// ------------------------------------------------------------
// resolveEngineChannelPreferring — é ELE que transforma "o operador escolheu
// a conexão X neste passo" em "a mensagem sai por X".
//
// Estava sem teste nenhum, e passou a ser a promessa do seletor "Enviar por"
// do builder de automações. A conta de produção tem uma conexão só, então
// esta é a única forma de provar a precedência.
// ------------------------------------------------------------

/** Conta com duas conexões: a da conversa e a "oficial", que o passo fixa. */
const dbDeDoisCanais = (canalDaConversa: string | null) =>
  makeDb({
    conversations: (f) =>
      f.id === 'conv1' && f.account_id === 'acc1'
        ? { data: { channel_id: canalDaConversa } }
        : { data: null },
    cb_channels: (f) => {
      if (f.account_id && f.account_id !== 'acc1') return { data: null };
      if (f.id === 'ch-evo') return { data: CH_EVO };
      if (f.id === 'ch-oficial') return { data: { ...CH_EVO, id: 'ch-oficial' } };
      if (f.is_default === true) return { data: { ...CH_EVO, id: 'ch-padrao' } };
      return { data: null };
    },
  });

describe('resolveEngineChannelPreferring', () => {
  it('CRÍTICO: o canal preferido VENCE o canal da conversa', async () => {
    // O caso do recurso: "o cliente escreveu no WhatsApp pessoal, mas a
    // confirmação formal sai SEMPRE pelo número oficial".
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais('ch-evo'),
      'acc1',
      'conv1',
      'ch-oficial',
    );
    expect(ch?.channelId).toBe('ch-oficial');
  });

  it('sem preferência cai no canal da conversa (comportamento de antes)', async () => {
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais('ch-evo'),
      'acc1',
      'conv1',
      undefined,
    );
    expect(ch?.channelId).toBe('ch-evo');
  });

  it('preferência nula é o mesmo que ausente — não zera o canal da conversa', async () => {
    // `stepChannel` devolve `cfg.channel_id ?? contexto ?? undefined`, e um
    // config antigo pode ter `channel_id: null` gravado. Se `null` fosse
    // tratado como "sem canal nenhum", o envio ficaria sem destino.
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais('ch-evo'),
      'acc1',
      'conv1',
      null,
    );
    expect(ch?.channelId).toBe('ch-evo');
  });

  it('CRÍTICO: canal preferido de OUTRA conta não vaza — cai no da conversa', async () => {
    // O motor roda em service-role e ignora RLS, então o `step_config` é a
    // única coisa entre um UUID digitado e o envio. O filtro por `account_id`
    // dentro do resolve é a barreira.
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais('ch-evo'),
      'acc1',
      'conv1',
      'ch-de-outra-conta',
    );
    expect(ch?.channelId).toBe('ch-evo');
  });

  it('canal preferido APAGADO falha aberta: a mensagem sai pelo canal da conversa', async () => {
    // É o estado que o aviso "conexão removida" do builder denuncia. Falha
    // aberta é deliberada — a alternativa seria a automação parar de enviar.
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais('ch-evo'),
      'acc1',
      'conv1',
      '00000000-0000-0000-0000-00000000dead',
    );
    expect(ch?.channelId).toBe('ch-evo');
  });

  it('preferido apagado E conversa sem canal → cai no padrão da conta', async () => {
    const ch = await resolveEngineChannelPreferring(
      dbDeDoisCanais(null),
      'acc1',
      'conv1',
      '00000000-0000-0000-0000-00000000dead',
    );
    expect(ch?.channelId).toBe('ch-padrao');
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
