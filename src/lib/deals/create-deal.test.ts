import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { createDeal } from './create-deal';

// ------------------------------------------------------------
// Stub do Supabase que REGISTRA o insert. O que estes testes protegem não é
// "retornou ok": é que o negócio nunca nasça num funil de outra conta, numa
// etapa que não é daquele funil, ou com a moeda errada — e que a colisão do
// índice único do roteador seja lida como sucesso, não como falha.
//
// `pipeline_stages` é consultada de DUAS formas (pela id, ou a primeira por
// `position`); o stub distingue pelo `.order()` ter sido chamado.
// ------------------------------------------------------------
type Linha = Record<string, unknown> | null;

interface Cfg {
  pipeline?: Linha;
  pipelineError?: { message: string };
  /** Resposta da busca de etapa POR ID. */
  stage?: Linha;
  /** Resposta da busca da etapa de menor `position`. */
  firstStage?: Linha;
  account?: Linha;
  insertError?: { code?: string; message: string };
}

function makeDb(cfg: Cfg): {
  db: SupabaseClient;
  inserts: Record<string, unknown>[];
} {
  const inserts: Record<string, unknown>[] = [];
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
        if (table === 'pipelines') {
          return Promise.resolve({ data: cfg.pipeline ?? null, error: cfg.pipelineError ?? null });
        }
        if (table === 'pipeline_stages') {
          return Promise.resolve({
            data: (ordenado ? cfg.firstStage : cfg.stage) ?? null,
            error: null,
          });
        }
        if (table === 'accounts') {
          return Promise.resolve({ data: cfg.account ?? null, error: null });
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
      return make();
    },
  } as unknown as SupabaseClient;

  return { db, inserts };
}

const BASE = {
  accountId: 'conta-1',
  ownerUserId: 'dono-1',
  contactId: 'contato-1',
  pipelineId: 'funil-1',
  title: 'Trabalhista — Maria',
  source: 'channel' as const,
};

describe('createDeal', () => {
  it('recusa funil que não é da conta', async () => {
    // A ingestão roda em service-role e ignora RLS — sem este filtro, um id
    // vindo de configuração antiga poderia apontar para outra conta.
    const { db, inserts } = makeDb({ pipeline: null });

    const r = await createDeal({ db, ...BASE });

    expect(r).toEqual({
      ok: false,
      code: 'pipeline_not_found',
      message: 'Funil não encontrado nesta conta.',
    });
    expect(inserts).toHaveLength(0);
  });

  it('recusa etapa que não pertence ao funil', async () => {
    const { db, inserts } = makeDb({ pipeline: { id: 'funil-1' }, stage: null });

    const r = await createDeal({ db, ...BASE, stageId: 'etapa-de-outro-funil' });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('stage_not_found');
    expect(inserts).toHaveLength(0);
  });

  it('recusa funil sem nenhuma etapa em vez de estourar no NOT NULL', async () => {
    // A tela de Funis permite apagar todas as etapas, e `deals.stage_id` é
    // NOT NULL — este é um caminho real, não hipótese.
    const { db, inserts } = makeDb({ pipeline: { id: 'funil-1' }, firstStage: null });

    const r = await createDeal({ db, ...BASE });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_stage');
    expect(inserts).toHaveLength(0);
  });

  it('sem etapa explícita, usa a de menor position', async () => {
    const { db, inserts } = makeDb({
      pipeline: { id: 'funil-1' },
      firstStage: { id: 'etapa-zero' },
      account: { default_currency: 'BRL' },
    });

    const r = await createDeal({ db, ...BASE });

    expect(r).toEqual({ ok: true, created: true });
    expect(inserts[0]).toMatchObject({ stage_id: 'etapa-zero' });
  });

  it('grava canal, origem, dono e a moeda DA CONTA', async () => {
    const { db, inserts } = makeDb({
      pipeline: { id: 'funil-1' },
      stage: { id: 'etapa-lead' },
      account: { default_currency: 'BRL' },
    });

    await createDeal({
      db,
      ...BASE,
      stageId: 'etapa-lead',
      channelId: 'canal-1',
      conversationId: 'conversa-1',
    });

    expect(inserts[0]).toMatchObject({
      account_id: 'conta-1',
      user_id: 'dono-1',
      pipeline_id: 'funil-1',
      stage_id: 'etapa-lead',
      contact_id: 'contato-1',
      channel_id: 'canal-1',
      conversation_id: 'conversa-1',
      currency: 'BRL',
      status: 'open',
      source: 'channel',
    });
  });

  it('sem conversa, grava o vínculo como nulo em vez de omitir a coluna', async () => {
    // A coluna precisa ir explícita: negócio criado por caminho que não tem
    // conversa (import, regra futura) fica com NULL, não com lixo herdado.
    const { db, inserts } = makeDb({
      pipeline: { id: 'funil-1' },
      firstStage: { id: 'etapa-zero' },
    });

    await createDeal({ db, ...BASE });

    expect(inserts[0]).toHaveProperty('conversation_id', null);
  });

  it('cai em USD quando a conta não tem moeda configurada', async () => {
    const { db, inserts } = makeDb({
      pipeline: { id: 'funil-1' },
      firstStage: { id: 'etapa-zero' },
      account: null,
    });

    await createDeal({ db, ...BASE });

    expect(inserts[0]).toMatchObject({ currency: 'USD' });
  });

  it('colisão do índice único vira sucesso idempotente, não erro', async () => {
    // Duas mensagens do mesmo cliente chegando juntas — ou a reentrega do
    // webhook da Meta — passam pela mesma checagem e disparam dois inserts.
    // O card que interessa já existe.
    const { db } = makeDb({
      pipeline: { id: 'funil-1' },
      firstStage: { id: 'etapa-zero' },
      insertError: { code: '23505', message: 'duplicate key' },
    });

    const r = await createDeal({ db, ...BASE });

    expect(r).toEqual({ ok: true, created: false });
  });

  it('erro de insert que NÃO é colisão é reportado', async () => {
    const { db } = makeDb({
      pipeline: { id: 'funil-1' },
      firstStage: { id: 'etapa-zero' },
      insertError: { code: '23503', message: 'foreign key violation' },
    });

    const r = await createDeal({ db, ...BASE });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('insert_failed');
      expect(r.message).toContain('foreign key');
    }
  });
});
