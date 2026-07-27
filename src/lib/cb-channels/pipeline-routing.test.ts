import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { routeInboundToPipeline } from './pipeline-routing';

// ------------------------------------------------------------
// Stub que registra QUAIS TABELAS foram consultadas, além dos inserts.
// A ordem das guardas é o desenho deste módulo, não detalhe: enquanto
// nenhuma conexão tiver funil configurado (estado de todas hoje), o custo
// por mensagem recebida tem de ser UM select em `cb_channels` e mais nada.
// Um teste que só olhasse o resultado deixaria essa regressão passar.
// ------------------------------------------------------------
type Linha = Record<string, unknown> | null;

interface Cfg {
  channel?: Linha;
  channelError?: { message: string };
  existingDeal?: Linha;
  dealSelectError?: { message: string };
  account?: Linha;
  pipeline?: Linha;
  firstStage?: Linha;
  stage?: Linha;
  insertError?: { code?: string; message: string };
}

function makeDb(cfg: Cfg): {
  db: SupabaseClient;
  inserts: Record<string, unknown>[];
  tabelas: string[];
} {
  const inserts: Record<string, unknown>[] = [];
  const tabelas: string[] = [];
  let table = '';

  const make = () => {
    let ordenado = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      limit: () => chain,
      order: () => {
        ordenado = true;
        return chain;
      },
      maybeSingle: () => {
        if (table === 'cb_channels') {
          return Promise.resolve({ data: cfg.channel ?? null, error: cfg.channelError ?? null });
        }
        if (table === 'deals') {
          return Promise.resolve({
            data: cfg.existingDeal ?? null,
            error: cfg.dealSelectError ?? null,
          });
        }
        if (table === 'accounts') {
          return Promise.resolve({ data: cfg.account ?? null, error: null });
        }
        if (table === 'pipelines') {
          return Promise.resolve({ data: cfg.pipeline ?? { id: 'funil-1' }, error: null });
        }
        if (table === 'pipeline_stages') {
          return Promise.resolve({
            data: ordenado
              ? (cfg.firstStage ?? { id: 'etapa-zero' })
              : (cfg.stage ?? { id: 'etapa-lead' }),
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      insert: (payload: Record<string, unknown>) => {
        inserts.push(payload);
        return Promise.resolve({ data: null, error: cfg.insertError ?? null });
      },
    };
    return chain;
  };

  const db = {
    from: (t: string) => {
      table = t;
      tabelas.push(t);
      return make();
    },
  } as unknown as SupabaseClient;

  return { db, inserts, tabelas };
}

const CANAL_CONFIGURADO = {
  label: 'Trabalhista',
  default_pipeline_id: 'funil-trabalhista',
  default_stage_id: 'etapa-lead',
};

const BASE = {
  accountId: 'conta-1',
  channelId: 'canal-1',
  contactId: 'contato-1',
  contactName: 'Maria Silva',
};

describe('routeInboundToPipeline', () => {
  it('não roteia quando o canal não resolveu', async () => {
    // O oposto de `channelInScope` do motor de automações, que deixa
    // contexto sem canal passar em qualquer escopo — é assim que aquele
    // caminho joga o cliente em todos os funis de uma vez.
    const { db, inserts, tabelas } = makeDb({ channel: CANAL_CONFIGURADO });

    await routeInboundToPipeline({ db, ...BASE, channelId: null });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toHaveLength(0);
  });

  it('não roteia conversa de grupo (sem contato)', async () => {
    // `deals.contact_id` é NULLABLE desde a migration 004: o banco NÃO
    // barraria o card órfão, que apareceria em branco no Kanban.
    const { db, inserts, tabelas } = makeDb({ channel: CANAL_CONFIGURADO });

    await routeInboundToPipeline({ db, ...BASE, contactId: null });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toHaveLength(0);
  });

  it('canal sem funil configurado sai sem tocar em deals', async () => {
    const { db, inserts, tabelas } = makeDb({
      channel: { label: 'Pessoal', default_pipeline_id: null, default_stage_id: null },
    });

    await routeInboundToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(0);
    expect(tabelas).toEqual(['cb_channels']);
  });

  it('não duplica quando o contato já tem card naquele funil', async () => {
    // Larga de propósito: vale para card criado à mão, por automação ou por
    // aqui, aberto ou fechado.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      existingDeal: { id: 'negocio-existente' },
    });

    await routeInboundToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(0);
  });

  it('cria o negócio com canal, etapa configurada, origem e dono da conta', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      existingDeal: null,
      account: { owner_user_id: 'dono-da-conta', default_currency: 'BRL' },
      stage: { id: 'etapa-lead' },
    });

    await routeInboundToPipeline({ db, ...BASE });

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      account_id: 'conta-1',
      contact_id: 'contato-1',
      pipeline_id: 'funil-trabalhista',
      stage_id: 'etapa-lead',
      channel_id: 'canal-1',
      user_id: 'dono-da-conta',
      source: 'channel',
    });
  });

  it('o título junta o canal e o contato', async () => {
    // `contact_id` é SET NULL quando o contato é apagado — sem o nome no
    // título o card ficaria sem nenhuma identificação.
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeInboundToPipeline({ db, ...BASE });

    expect(inserts[0]).toMatchObject({ title: 'Trabalhista — Maria Silva' });
  });

  it('contato sem nome ainda gera título utilizável', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
    });

    await routeInboundToPipeline({ db, ...BASE, contactName: null });

    expect(inserts[0]).toMatchObject({ title: 'Trabalhista' });
  });

  it('falha na checagem de duplicata não cria nada nem lança', async () => {
    const { db, inserts } = makeDb({
      channel: CANAL_CONFIGURADO,
      dealSelectError: { message: 'timeout' },
    });

    await expect(routeInboundToPipeline({ db, ...BASE })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
  });

  it('falha do escritor não propaga — o fan-out da ingestão segue', async () => {
    const { db } = makeDb({
      channel: CANAL_CONFIGURADO,
      account: { owner_user_id: 'dono-da-conta' },
      insertError: { code: '23503', message: 'foreign key violation' },
    });

    await expect(routeInboundToPipeline({ db, ...BASE })).resolves.toBeUndefined();
  });

  it('erro ao ler o canal não propaga', async () => {
    const { db, inserts } = makeDb({ channelError: { message: 'conexão caiu' } });

    await expect(routeInboundToPipeline({ db, ...BASE })).resolves.toBeUndefined();
    expect(inserts).toHaveLength(0);
  });
});
