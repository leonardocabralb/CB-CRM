import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// O nó "Mover card de etapa" do robô (1053). O card é o que as automações
// achariam (`negocioAlvo`, trocado aqui por um espião — a régua dele tem
// teste no motor de automações), e a escrita vai pela RPC delas.
// ============================================================

const alvo = vi.fn();
vi.mock('@/lib/automations/engine', () => ({
  negocioAlvo: (...a: unknown[]) => alvo(...a),
}));

const criar = vi.fn();
vi.mock('@/lib/deals/create-deal', () => ({
  createDeal: (...a: unknown[]) => criar(...a),
}));

import {
  lerConfigDoMoverCard,
  moverCardDoNo,
  origemPermite,
  payloadDoMoverCard,
} from './mover-card';

const CFG = {
  pipeline_id: 'funil-prev',
  stage_id: 'etapa-mql',
  origem_stage_ids: ['etapa-pre'],
  next_node_key: 'fim',
};

const ENTRADA = {
  accountId: 'acc',
  userId: 'autor',
  flowId: 'robo-1',
  contactId: 'ct',
  conversationId: 'conv',
  channelId: 'ch',
};

interface Estado {
  existente: { id: string } | null;
  existenteErro: string | null;
  card: { stage_id: string | null; status: string } | null;
  contato: Record<string, unknown> | null;
  /** A etapa de destino, lida por (id, funil) antes da RPC. */
  etapa: { id: string } | null;
  etapaErro: string | null;
  rpc: { data: unknown; error: { message: string } | null };
}

let estado: Estado;
let rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
let consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }>;

function banco(): SupabaseClient {
  return {
    from(tabela: string) {
      const pedido = { tabela, filtros: [] as Array<[string, unknown]> };
      consultas.push(pedido);
      let comLimite = false;
      const b = {
        select: () => b,
        eq: (c: string, v: unknown) => (pedido.filtros.push([c, v]), b),
        limit: () => ((comLimite = true), b),
        maybeSingle: () => {
          if (tabela === 'contacts') return Promise.resolve({ data: estado.contato, error: null });
          if (tabela === 'deals' && comLimite) {
            return Promise.resolve({
              data: estado.existente,
              error: estado.existenteErro ? { message: estado.existenteErro } : null,
            });
          }
          if (tabela === 'deals') return Promise.resolve({ data: estado.card, error: null });
          if (tabela === 'pipeline_stages') {
            return Promise.resolve({
              data: estado.etapa,
              error: estado.etapaErro ? { message: estado.etapaErro } : null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      return b;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      return Promise.resolve(estado.rpc);
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  alvo.mockReset();
  criar.mockReset();
  rpcs = [];
  consultas = [];
  estado = {
    existente: null,
    existenteErro: null,
    card: { stage_id: 'etapa-pre', status: 'open' },
    contato: { name: 'Maria Teste', phone: '5583999990000' },
    etapa: { id: 'etapa-mql' },
    etapaErro: null,
    rpc: { data: [{ ok: true, motivo: null, status_gravado: 'open' }], error: null },
  };
});

describe('lerConfigDoMoverCard', () => {
  it('lê funil, etapa e origens (sem repetidas nem vazias)', () => {
    expect(
      lerConfigDoMoverCard({
        pipeline_id: ' f ',
        stage_id: 'e',
        origem_stage_ids: ['a', 'a', '', 3, ' b '],
      }),
    ).toEqual({ funilId: 'f', etapaId: 'e', origens: ['a', 'b'] });
  });

  it('sem funil ou sem etapa = null', () => {
    expect(lerConfigDoMoverCard({ pipeline_id: 'f' })).toBeNull();
    expect(lerConfigDoMoverCard({ stage_id: 'e' })).toBeNull();
    expect(lerConfigDoMoverCard(null)).toBeNull();
  });

  it('origens ausentes = lista vazia (qualquer etapa)', () => {
    expect(lerConfigDoMoverCard({ pipeline_id: 'f', stage_id: 'e' })?.origens).toEqual([]);
  });
});

describe('origemPermite', () => {
  it('lista vazia = qualquer etapa', () => {
    expect(origemPermite([], 'x')).toBe(true);
    expect(origemPermite([], null)).toBe(true);
  });
  it('com lista, só as marcadas', () => {
    expect(origemPermite(['a', 'b'], 'b')).toBe(true);
    expect(origemPermite(['a', 'b'], 'c')).toBe(false);
    expect(origemPermite(['a'], null)).toBe(false);
  });
});

describe('payloadDoMoverCard', () => {
  it('o que não moveu leva `reason`; o que moveu, só `deal`', () => {
    expect(payloadDoMoverCard({ resultado: 'movido', dealId: 'd', statusGravado: 'open' })).toEqual({
      node_type: 'move_deal_stage',
      deal: 'moved',
      deal_id: 'd',
      deal_status: 'open',
    });
    expect(payloadDoMoverCard({ resultado: 'fora_da_origem', dealId: 'd', etapaAtual: 'x' }).reason).toMatch(
      /outside the allowed origin/,
    );
    expect(payloadDoMoverCard({ resultado: 'so_ganho' }).reason).toMatch(/WON/);
    expect(payloadDoMoverCard({ resultado: 'sem_contato' }).reason).toMatch(/no contact/);
  });

  it('criado e já na etapa: `deal` com o id, sem `reason`', () => {
    expect(payloadDoMoverCard({ resultado: 'criado', dealId: 'n' })).toEqual({
      node_type: 'move_deal_stage',
      deal: 'created',
      deal_id: 'n',
    });
    expect(payloadDoMoverCard({ resultado: 'ja_estava', dealId: 'd' })).toEqual({
      node_type: 'move_deal_stage',
      deal: 'already_there',
      deal_id: 'd',
    });
  });

  it('o card criado por outro caminho no mesmo instante NÃO vira "created" com id nulo', () => {
    const p = payloadDoMoverCard({ resultado: 'ja_existia' });
    expect(p.deal).toBe('not_moved');
    expect(p.reason).toMatch(/another card/);
    expect(p).not.toHaveProperty('deal_id');
  });
});

describe('moverCardDoNo', () => {
  it('move o card pela RPC das automações, com a guarda de status e a cadeia do robô', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'movido', dealId: 'deal-1', statusGravado: 'open' });
    expect(rpcs).toEqual([
      {
        fn: 'cb_atualizar_negocio',
        args: {
          p_deal_id: 'deal-1',
          p_account_id: 'acc',
          p_pipeline_id: null,
          p_stage_id: 'etapa-mql',
          p_status: null,
          p_cadeia: ['flow:robo-1'],
          p_status_esperado: 'open',
        },
      },
    ]);
    // O card é lido NESTA conta.
    const leitura = consultas.find((c) => c.tabela === 'deals');
    expect(leitura?.filtros).toContainEqual(['account_id', 'acc']);
  });

  it('a busca é a das automações, pelo CONTATO (contexto vazio) e pela conta', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    await moverCardDoNo(banco(), ENTRADA, CFG);
    const args = alvo.mock.calls[0][1] as {
      automation: { account_id: string };
      contactId: string;
      context: Record<string, unknown>;
    };
    expect(args.automation.account_id).toBe('acc');
    expect(args.contactId).toBe('ct');
    expect(args.context).toEqual({});
  });

  it('TRAVA DE ORIGEM: card fora das etapas permitidas NÃO move (e não chama a RPC)', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.card = { stage_id: 'etapa-do-bancario', status: 'open' };
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'fora_da_origem', dealId: 'deal-1', etapaAtual: 'etapa-do-bancario' });
    expect(rpcs).toEqual([]);
  });

  it('sem lista de origem, move de QUALQUER etapa (inclusive de outro funil)', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.card = { stage_id: 'etapa-do-bancario', status: 'open' };
    const r = await moverCardDoNo(banco(), ENTRADA, { ...CFG, origem_stage_ids: [] });
    expect(r.resultado).toBe('movido');
  });

  it('card aberto que JÁ está no destino: nada a fazer (nem a origem se aplica)', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.card = { stage_id: 'etapa-mql', status: 'open' };
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'ja_estava', dealId: 'deal-1' });
    expect(rpcs).toEqual([]);
  });

  it('o PERDIDO parado no destino vai à RPC (que o reabre, 1031), com o status visto', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'lost' });
    estado.card = { stage_id: 'etapa-mql', status: 'lost' };
    const r = await moverCardDoNo(banco(), ENTRADA, { ...CFG, origem_stage_ids: [] });
    expect(r.resultado).toBe('movido');
    expect(rpcs[0].args.p_status_esperado).toBe('lost');
  });

  it('o PERDIDO parado no destino passa pela trava de origem: lista sem o destino NÃO o reabre', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'lost' });
    estado.card = { stage_id: 'etapa-mql', status: 'lost' };
    // CFG só permite sair de "etapa-pre": o perdido em MQL fica perdido.
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'fora_da_origem', dealId: 'deal-1', etapaAtual: 'etapa-mql' });
    expect(rpcs).toEqual([]);

    // Com o destino na lista, a RPC o reabre.
    const r2 = await moverCardDoNo(banco(), ENTRADA, { ...CFG, origem_stage_ids: ['etapa-pre', 'etapa-mql'] });
    expect(r2.resultado).toBe('movido');
  });

  it('etapa que NÃO é do funil configurado LANÇA antes da RPC (a RPC seguiria o funil da etapa)', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.etapa = null;
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/not in the chosen pipeline/);
    expect(rpcs).toEqual([]);
    const leitura = consultas.find((c) => c.tabela === 'pipeline_stages');
    expect(leitura?.filtros).toEqual([
      ['id', 'etapa-mql'],
      ['pipeline_id', 'funil-prev'],
    ]);
  });

  it('erro ao ler a etapa LANÇA (nunca move sem conferir)', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.etapaErro = 'timeout';
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/stage lookup failed/);
    expect(rpcs).toEqual([]);
  });

  it('SEM card nenhum: CRIA na etapa de destino, título pela 1007, sem marca', async () => {
    alvo.mockResolvedValue(null);
    criar.mockResolvedValue({ ok: true, created: true, deal: { id: 'novo' } });
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'criado', dealId: 'novo' });
    expect(criar).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc',
        ownerUserId: 'autor',
        contactId: 'ct',
        pipelineId: 'funil-prev',
        stageId: 'etapa-mql',
        channelId: 'ch',
        conversationId: 'conv',
        title: 'Maria Teste',
        tituloFixadoEm: null,
        source: 'automation',
      }),
    );
    expect(rpcs).toEqual([]);
  });

  it('sem nome na ficha, o título é a identidade (telefone); sem nada, o rótulo de reserva', async () => {
    alvo.mockResolvedValue(null);
    criar.mockResolvedValue({ ok: true, created: true, deal: { id: 'novo' } });
    estado.contato = { name: null, phone: '5583999990000' };
    await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(criar.mock.calls[0][0].title).toBe('5583999990000');

    estado.contato = { name: null, phone: null };
    await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(criar.mock.calls[1][0].title).toBe('Novo contato');
  });

  it('contato que só tem card GANHO (cliente): não move e NÃO cria um segundo', async () => {
    alvo.mockResolvedValue(null);
    estado.existente = { id: 'ganho' };
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'so_ganho' });
    expect(criar).not.toHaveBeenCalled();
    expect(rpcs).toEqual([]);
    // A pergunta "tem QUALQUER card?" é desta conta e deste contato.
    const qualquer = consultas.find((c) => c.tabela === 'deals');
    expect(qualquer?.filtros).toEqual([
      ['account_id', 'acc'],
      ['contact_id', 'ct'],
    ]);
  });

  it('createDeal com `created: false` (corrida do índice) registra `ja_existia`, nunca "criado"', async () => {
    alvo.mockResolvedValue(null);
    criar.mockResolvedValue({ ok: true, created: false, deal: null });
    const r = await moverCardDoNo(banco(), ENTRADA, CFG);
    expect(r).toEqual({ resultado: 'ja_existia' });
  });

  it('GRUPO nunca: sem contato, não procura nem cria card', async () => {
    const r = await moverCardDoNo(banco(), { ...ENTRADA, contactId: null }, CFG);
    expect(r).toEqual({ resultado: 'sem_contato' });
    expect(alvo).not.toHaveBeenCalled();
    expect(criar).not.toHaveBeenCalled();
  });

  it('erro de banco na busca LANÇA (nunca vira "sem card" → criaria um segundo)', async () => {
    alvo.mockResolvedValue(null);
    estado.existenteErro = 'timeout';
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/deal lookup failed/);
    expect(criar).not.toHaveBeenCalled();
  });

  it('RPC que recusa (status mudou no meio) LANÇA com o motivo', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.rpc = { data: [{ ok: false, motivo: 'o negocio deixou de estar open durante a automacao' }], error: null };
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/move refused: o negocio deixou/);
  });

  it('erro da RPC LANÇA', async () => {
    alvo.mockResolvedValue({ id: 'deal-1', statusVisto: 'open' });
    estado.rpc = { data: null, error: { message: 'etapa nao existe' } };
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/move failed: etapa nao existe/);
  });

  it('criação recusada LANÇA com o motivo de createDeal', async () => {
    alvo.mockResolvedValue(null);
    criar.mockResolvedValue({ ok: false, code: 'stage_not_found', message: 'A etapa escolhida não pertence a este funil.' });
    await expect(moverCardDoNo(banco(), ENTRADA, CFG)).rejects.toThrow(/não pertence a este funil/);
  });

  it('config sem destino LANÇA (o validador já recusa na ativação)', async () => {
    await expect(moverCardDoNo(banco(), ENTRADA, { next_node_key: 'fim' })).rejects.toThrow(
      /needs a pipeline/,
    );
  });
});

// ------------------------------------------------------------
// ⚠️ PINO: `negocioAlvo` recebe o `ExecuteArgs` inteiro do motor de
// automações, e o robô monta SÓ os quatro campos que ela lê hoje. Se o corpo
// dela passar a ler outro campo de `args`, o robô mandaria `undefined` calado
// — este teste reprova antes. Quem mudar `negocioAlvo` decide aqui se o robô
// precisa do campo novo (e o acrescenta em `argsDoAlvo`).
// ------------------------------------------------------------
describe('pino: o que `negocioAlvo` lê de `args`', () => {
  it('só context.deal_id, context.deal_status_fixado, contactId e automation.account_id', () => {
    const fonte = fs.readFileSync(
      path.resolve(__dirname, '..', 'automations', 'engine.ts'),
      'utf8',
    );
    const inicio = fonte.indexOf('export async function negocioAlvo(');
    expect(inicio).toBeGreaterThan(-1);
    // O corpo vai até a próxima declaração de função no nível do módulo.
    const resto = fonte.slice(inicio + 10);
    const fim = resto.search(/\n(?:export )?(?:async )?function /);
    const corpo = resto.slice(0, fim === -1 ? undefined : fim);
    const lidos = [...new Set(corpo.match(/args\.[\w.]+/g) ?? [])].sort();
    expect(lidos).toEqual(
      [
        'args.automation.account_id',
        'args.contactId',
        'args.context.deal_id',
        'args.context.deal_status_fixado',
      ].sort(),
    );
  });

  it('o robô monta exatamente esses campos (e nada da execução de automação)', () => {
    const fonte = fs.readFileSync(path.resolve(__dirname, 'mover-card.ts'), 'utf8');
    const inicio = fonte.indexOf('function argsDoAlvo(');
    const corpo = fonte.slice(inicio, fonte.indexOf('\n}\n', inicio));
    expect(corpo).toContain('automation: { account_id: accountId }');
    expect(corpo).toContain('contactId,');
    expect(corpo).toContain('context: {}');
  });
});
