import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/automations/avisar-drenagem', () => ({ avisarDrenagemDeFunil: vi.fn() }));

import { avisarDrenagemDeFunil } from '@/lib/automations/avisar-drenagem';

import { executarAcao } from './executar';
import type { ReuniaoDaPauta } from './pauta';

/** Um cliente falso que grava o que a função pediu ao banco. */
function falso(opcoes: { linhasDoUpdate?: number; erroDoUpdate?: boolean; erroDoUpsert?: boolean } = {}) {
  const chamadas: { tabela: string; op: string; valor: unknown; filtros: [string, unknown][]; opcoes?: unknown }[] = [];
  const cliente = {
    from(tabela: string) {
      return {
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

  it('card JÁ na etapa do botão: nenhuma escrita no card, só o marco (é o que resolve a reunião)', async () => {
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
    expect(chamadas.map((c) => c.op)).toEqual(['upsert']);
    expect(chamadas[0].valor).toMatchObject({ marco: 'qualificada', resultado: null, valor: null });
    expect(avisarDrenagemDeFunil).not.toHaveBeenCalled();
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

  it('proposta só registrada guarda o valor no marco', async () => {
    const { cliente, chamadas } = falso();
    await executarAcao({ supabase: cliente, accountId: 'conta', reuniao, acao: 'proposta', destino: null, valor: 900 });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].valor).toMatchObject({ marco: 'resultado', resultado: 'proposta', valor: 900 });
  });
});
