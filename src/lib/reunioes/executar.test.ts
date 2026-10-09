import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/automations/avisar-drenagem', () => ({ avisarDrenagemDeFunil: vi.fn() }));

import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';

import { executarAcao } from './executar';
import type { ReuniaoDaPauta } from './pauta';

/** Um cliente falso que grava o que a função pediu ao banco. */
function falso(
  opcoes: { linhasDoUpdate?: number; erroDoUpdate?: boolean; erroDoUpsert?: boolean; linhasDoSelect?: number; erroDoSelect?: boolean } = {},
) {
  const chamadas: { tabela: string; op: string; valor: unknown; filtros: [string, unknown][]; opcoes?: unknown }[] = [];
  const cliente = {
    from(tabela: string) {
      return {
        select(colunas: unknown) {
          const c = { tabela, op: 'select', valor: colunas, filtros: [] as [string, unknown][] };
          chamadas.push(c);
          const resposta = opcoes.erroDoSelect
            ? { data: null, error: { message: 'x' } }
            : { data: Array.from({ length: opcoes.linhasDoSelect ?? 1 }, () => ({ id: 'd1' })), error: null };
          const q = {
            eq(col: string, v: unknown) {
              c.filtros.push([col, v]);
              return q;
            },
            then(ok: (r: typeof resposta) => unknown, erro?: (e: unknown) => unknown) {
              return Promise.resolve(resposta).then(ok, erro);
            },
          };
          return q;
        },
        update(valor: unknown) {
          const c = { tabela, op: 'update', valor, filtros: [] as [string, unknown][] };
          chamadas.push(c);
          const q = {
            eq(col: string, v: unknown) {
              c.filtros.push([col, v]);
              return q;
            },
            select() {
              return Promise.resolve(
                opcoes.erroDoUpdate
                  ? { data: null, error: { message: 'x' } }
                  : { data: Array.from({ length: opcoes.linhasDoUpdate ?? 1 }, () => ({ id: 'd1' })), error: null },
              );
            },
          };
          return q;
        },
        upsert(valor: unknown, o: unknown) {
          chamadas.push({ tabela, op: 'upsert', valor, filtros: [], opcoes: o });
          return Promise.resolve({ error: opcoes.erroDoUpsert ? { message: 'x' } : null });
        },
      };
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, chamadas };
}

const reuniao: ReuniaoDaPauta = {
  chave: 'calendly:r1',
  origem: 'calendly',
  reuniaoId: 'r1',
  inicio: '2026-09-29T14:00:00Z',
  fim: null,
  evento: null,
  link: null,
  reagendamento: false,
  remarcadaDe: null,
  proximaEm: null,
  contato: { id: 'c1', nome: 'Ana' },
  conversaId: 'v1',
  negocio: { id: 'd1', pipelineId: 'banc', pipelineNome: null, etapaId: 'agendada', etapaNome: null, valor: 0, status: 'open' },
  qualificacao: { divida: null, atraso: null, origem: null },
  qualificada: null,
  resultado: null,
  faltouAntes: null,
  aguardandoDesde: null,
};

beforeEach(() => vi.mocked(avisarDrenagemDeFunil).mockClear());

describe('executarAcao', () => {
  it('com proposta: etapa e VALOR na mesma escrita, cercada pela etapa vista; depois o marco', async () => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'proposta',
      destino: { id: 'prop', nome: 'Proposta Realizada' },
      valor: 18000,
    });
    expect(r).toEqual({ desfecho: 'ok', moveu: true });
    // O que viaja é o JSON: chave `undefined` não sai.
    expect(JSON.parse(JSON.stringify(chamadas[0].valor))).toEqual({ stage_id: 'prop', value: 18000 });
    expect(chamadas[0]).toEqual({
      tabela: 'deals',
      op: 'update',
      valor: { stage_id: 'prop', value: 18000 },
      filtros: [
        ['id', 'd1'],
        ['stage_id', 'agendada'],
        ['status', 'open'],
      ],
    });
    expect(chamadas[1]).toMatchObject({
      tabela: 'cb_reunioes_marcos',
      op: 'upsert',
      valor: { account_id: 'conta', origem: 'calendly', reuniao_id: 'r1', marco: 'resultado', resultado: 'proposta', valor: 18000 },
      opcoes: { onConflict: 'account_id,origem,reuniao_id,marco' },
    });
    expect(avisarDrenagemDeFunil).toHaveBeenCalledTimes(1);
  });

  it('card que mudou de etapa (zero linhas): não grava o marco', async () => {
    const { cliente, chamadas } = falso({ linhasDoUpdate: 0 });
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'no_show',
      destino: { id: 'noshow', nome: 'No Show' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'card_mudou', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['update']);
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
  });

  it('erro no card: falhou, sem marco', async () => {
    const { cliente, chamadas } = falso({ erroDoUpdate: true });
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'sem_proposta',
      destino: { id: 'semprop', nome: 'Reunião Sem Proposta' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'falhou', moveu: false });
    expect(chamadas).toHaveLength(1);
  });

  it('card JÁ na etapa do botão: nenhuma escrita no card, a MESMA cerca conferida por leitura, e o marco', async () => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao: { ...reuniao, negocio: { ...reuniao.negocio!, etapaId: 'mql2' } },
      acao: 'qualificada',
      destino: { id: 'mql2', nome: 'MQL 2' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'ok', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['select', 'upsert']);
    expect(chamadas[0].filtros).toEqual([
      ['id', 'd1'],
      ['stage_id', 'mql2'],
      ['status', 'open'],
    ]);
    expect(chamadas[1].valor).toMatchObject({ marco: 'qualificada', resultado: null, valor: null });
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
  });

  it('card JÁ na etapa, mas movido ou fechado depois da carga: card_mudou, sem marco', async () => {
    const { cliente, chamadas } = falso({ linhasDoSelect: 0 });
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao: { ...reuniao, negocio: { ...reuniao.negocio!, etapaId: 'noshow' } },
      acao: 'no_show',
      destino: { id: 'noshow', nome: 'No Show' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'card_mudou', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['select']);
  });

  it('marco que falha depois do card movido: registro_falhou', async () => {
    const { cliente } = falso({ erroDoUpsert: true });
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'no_show',
      destino: { id: 'noshow', nome: 'No Show' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'registro_falhou', moveu: true });
  });

  it('sem destino (só registra): nenhuma escrita no card, só o marco', async () => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao: { ...reuniao, negocio: null },
      acao: 'no_show',
      destino: null,
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'ok', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['upsert']);
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
  });

  it.each([null, 0, -5])('com proposta sem valor (%s): não move o card nem registra', async (valor) => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'proposta',
      destino: { id: 'prop', nome: 'Proposta Realizada' },
      valor,
    });
    expect(r).toEqual({ desfecho: 'falhou', moveu: false });
    expect(chamadas).toHaveLength(0);
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
  });

  it('proposta só registrada guarda o valor no marco', async () => {
    const { cliente, chamadas } = falso();
    await executarAcao({ supabase: cliente, accountId: 'conta', reuniao, acao: 'proposta', destino: null, valor: 900 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].valor).toMatchObject({ marco: 'resultado', resultado: 'proposta', valor: 900 });
  });

  // O marco grava o início que a tela via (1081): é o que deixa o Reagendar
  // valer antes do horário só para ESSE horário (`marcoValeParaAReuniao`).
  it.each(['qualificada', 'proposta', 'sem_proposta', 'reagendar', 'no_show'] as const)(
    'o marco de %s leva o início da reunião que a tela via',
    async (acao) => {
      const { cliente, chamadas } = falso();
      const remarcada = { ...reuniao, inicio: '2026-10-02T19:00:00.000Z', remarcadaDe: '2026-10-01T19:45:00Z' };
      const r = await executarAcao({
        supabase: cliente,
        accountId: 'conta',
        reuniao: remarcada,
        acao,
        destino: null,
        valor: acao === 'proposta' ? 900 : null,
      });
      expect(r.desfecho).toBe('ok');
      const upsert = chamadas.find((c) => c.op === 'upsert');
      expect(upsert?.valor).toMatchObject({ inicio: '2026-10-02T19:00:00.000Z' });
      // O que viaja é o JSON: a chave tem de sair no corpo.
      expect(JSON.parse(JSON.stringify(upsert?.valor))).toHaveProperty('inicio', '2026-10-02T19:00:00.000Z');
    },
  );

  it('reagendar: move o card para o destino com a cerca de etapa e status; o marco é resultado reagendar, sem valor', async () => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'reagendar',
      destino: { id: 'reag', nome: 'Reagendar' },
      // Um valor que sobrou no campo não vai nem para o card nem para o marco.
      valor: 500,
    });
    expect(r).toEqual({ desfecho: 'ok', moveu: true });
    expect(chamadas.map((c) => c.op)).toEqual(['update', 'upsert']);
    expect(JSON.parse(JSON.stringify(chamadas[0].valor))).toEqual({ stage_id: 'reag' });
    expect(chamadas[0]).toMatchObject({
      tabela: 'deals',
      filtros: [
        ['id', 'd1'],
        ['stage_id', 'agendada'],
        ['status', 'open'],
      ],
    });
    expect(chamadas[1]).toMatchObject({
      tabela: 'cb_reunioes_marcos',
      valor: {
        account_id: 'conta',
        origem: 'calendly',
        reuniao_id: 'r1',
        marco: 'resultado',
        resultado: 'reagendar',
        valor: null,
        inicio: '2026-09-29T14:00:00Z',
      },
      opcoes: { onConflict: 'account_id,origem,reuniao_id,marco' },
    });
    expect(avisarDrenagemDeFunil).toHaveBeenCalledTimes(1);
  });

  it('reagendar com o card JÁ na etapa (movido pelo quadro antes da hora): a mesma cerca por leitura, e o marco confirma', async () => {
    const { cliente, chamadas } = falso();
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao: { ...reuniao, negocio: { ...reuniao.negocio!, etapaId: 'reag' } },
      acao: 'reagendar',
      destino: { id: 'reag', nome: 'Reagendar' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'ok', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['select', 'upsert']);
    expect(chamadas[0].filtros).toEqual([
      ['id', 'd1'],
      ['stage_id', 'reag'],
      ['status', 'open'],
    ]);
    expect(chamadas[1].valor).toMatchObject({ marco: 'resultado', resultado: 'reagendar', valor: null, inicio: '2026-09-29T14:00:00Z' });
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
  });

  it('reagendar com o card movido por outro depois da carga (zero linhas): card_mudou, sem marco', async () => {
    const { cliente, chamadas } = falso({ linhasDoUpdate: 0 });
    const r = await executarAcao({
      supabase: cliente,
      accountId: 'conta',
      reuniao,
      acao: 'reagendar',
      destino: { id: 'reag', nome: 'Reagendar' },
      valor: null,
    });
    expect(r).toEqual({ desfecho: 'card_mudou', moveu: false });
    expect(chamadas.map((c) => c.op)).toEqual(['update']);
  });
});
