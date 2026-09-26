import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// O módulo importa o cliente do navegador para o hook; aqui só as funções
// puras e a carga (com um banco falso) são exercitadas.
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { carregarCatalogoDoFunil, montarCatalogo, nomeDaEtapa } from './catalogo-do-funil';

// O catálogo de funis do editor do robô (1053): agrupa as etapas por funil,
// na ordem da posição, e só dá nome quando SABE — "carregando" e "falhou"
// nunca viram "não existe".

const FUNIS = [
  { id: 'f-prev', name: 'Previdenciário' },
  { id: 'f-banc', name: 'Bancário' },
];
const ETAPAS = [
  { id: 'e3', name: 'Qualificado (MQL)', pipeline_id: 'f-prev', position: 2 },
  { id: 'e1', name: 'Novo lead', pipeline_id: 'f-prev', position: 0 },
  { id: 'e2', name: 'Pré-qualificação', pipeline_id: 'f-prev', position: 1 },
  { id: 'b1', name: 'Lead', pipeline_id: 'f-banc', position: null },
  { id: 'x1', name: 'Órfã', pipeline_id: 'f-apagado', position: 0 },
];

describe('montarCatalogo', () => {
  it('agrupa por funil, na ordem da posição, e descarta etapa de funil que não veio', () => {
    expect(montarCatalogo(FUNIS, ETAPAS)).toEqual([
      {
        id: 'f-prev',
        name: 'Previdenciário',
        etapas: [
          { id: 'e1', name: 'Novo lead' },
          { id: 'e2', name: 'Pré-qualificação' },
          { id: 'e3', name: 'Qualificado (MQL)' },
        ],
      },
      { id: 'f-banc', name: 'Bancário', etapas: [{ id: 'b1', name: 'Lead' }] },
    ]);
  });

  it('funil sem etapas aparece com a lista vazia', () => {
    expect(montarCatalogo([{ id: 'f', name: 'Vazio' }], [])).toEqual([
      { id: 'f', name: 'Vazio', etapas: [] },
    ]);
  });
});

describe('nomeDaEtapa', () => {
  const pronto = { status: 'pronto' as const, funis: montarCatalogo(FUNIS, ETAPAS) };

  it('acha o nome em qualquer funil', () => {
    expect(nomeDaEtapa(pronto, 'e3')).toBe('Qualificado (MQL)');
    expect(nomeDaEtapa(pronto, 'b1')).toBe('Lead');
  });

  it('não conhece = null (e carregando/falhou também é null, nunca "apagada")', () => {
    expect(nomeDaEtapa(pronto, 'nao-existe')).toBeNull();
    expect(nomeDaEtapa({ status: 'carregando' }, 'e3')).toBeNull();
    expect(nomeDaEtapa({ status: 'falhou' }, 'e3')).toBeNull();
  });
});

// ⚠️ O recorte é pela CONTA DO ROBÔ, não só pela RLS: a leitura da 1032
// devolve os funis de toda conta de que a pessoa é membro, e o funil de outra
// conta seria oferecido e recusado na ativação ("não existe mais").
describe('carregarCatalogoDoFunil', () => {
  type Pedido = { tabela: string; filtros: Array<[string, string, unknown]> };

  function banco(resp: {
    funis: { data: unknown; error: { message: string } | null };
    etapas?: { data: unknown; error: { message: string } | null };
  }) {
    const pedidos: Pedido[] = [];
    const db = {
      from(tabela: string) {
        const pedido: Pedido = { tabela, filtros: [] };
        pedidos.push(pedido);
        const r = tabela === 'pipelines' ? resp.funis : resp.etapas;
        const b = {
          select: () => b,
          eq: (c: string, v: unknown) => (pedido.filtros.push(['eq', c, v]), b),
          in: (c: string, v: unknown) => (pedido.filtros.push(['in', c, v]), b),
          order: () => Promise.resolve(r),
        };
        return b;
      },
    } as unknown as SupabaseClient;
    return { db, pedidos };
  }

  it('lê os funis DA CONTA do robô e as etapas SÓ desses funis', async () => {
    const { db, pedidos } = banco({
      funis: { data: FUNIS, error: null },
      etapas: { data: ETAPAS, error: null },
    });
    const c = await carregarCatalogoDoFunil(db, 'conta-do-robo');
    expect(pedidos[0]).toEqual({ tabela: 'pipelines', filtros: [['eq', 'account_id', 'conta-do-robo']] });
    expect(pedidos[1]).toEqual({
      tabela: 'pipeline_stages',
      filtros: [['in', 'pipeline_id', ['f-prev', 'f-banc']]],
    });
    expect(c.status).toBe('pronto');
    if (c.status === 'pronto') expect(c.funis.map((f) => f.id)).toEqual(['f-prev', 'f-banc']);
  });

  it('conta sem funil: pronto e vazio, sem pedir etapas (um `.in` vazio)', async () => {
    const { db, pedidos } = banco({ funis: { data: [], error: null } });
    expect(await carregarCatalogoDoFunil(db, 'c')).toEqual({ status: 'pronto', funis: [] });
    expect(pedidos).toHaveLength(1);
  });

  it('qualquer das duas leituras que falha = "falhou", nunca catálogo pela metade', async () => {
    expect(
      await carregarCatalogoDoFunil(banco({ funis: { data: null, error: { message: 'x' } } }).db, 'c'),
    ).toEqual({ status: 'falhou' });
    expect(
      await carregarCatalogoDoFunil(
        banco({ funis: { data: FUNIS, error: null }, etapas: { data: null, error: { message: 'x' } } }).db,
        'c',
      ),
    ).toEqual({ status: 'falhou' });
  });
});
