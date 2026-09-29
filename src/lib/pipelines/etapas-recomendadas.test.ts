import { describe, expect, it } from 'vitest';

import {
  emLista,
  type EtapaDoFunil,
  MAXIMO_DE_OPCOES,
  MINIMO_DE_MOVIMENTOS,
  type Movimento,
  recomendarEtapas,
} from './etapas-recomendadas';

// O funil Bancário - Comercial como estava em 29/09/2026 (posições e
// resultados reais), e os movimentos dos 30 dias anteriores, medidos.
const F = 'funil-bancario';
const etapa = (id: string, position: number, resultado: string | null = null): EtapaDoFunil => ({
  id,
  pipeline_id: F,
  position,
  resultado,
});
const ETAPAS: EtapaDoFunil[] = [
  etapa('avulso', 0),
  etapa('desqualificado', 1, 'perdido'),
  etapa('lead', 2),
  etapa('mql1', 3),
  etapa('agendada', 4),
  etapa('mql2', 5),
  etapa('noshow', 6),
  etapa('sem-proposta', 7),
  etapa('proposta', 8),
  etapa('contrato', 9, 'ganho'),
  etapa('perdido', 10, 'perdido'),
];
const mov = (de: string, para: string, vezes: number): Movimento => ({ de, para, vezes });
const MOVIMENTOS: Movimento[] = [
  mov('avulso', 'mql1', 38),
  mov('avulso', 'agendada', 12),
  mov('avulso', 'mql2', 1),
  mov('avulso', 'proposta', 1),
  mov('lead', 'agendada', 72),
  mov('lead', 'avulso', 30),
  mov('lead', 'mql1', 28),
  mov('mql1', 'agendada', 17),
  mov('mql1', 'avulso', 6),
  mov('mql1', 'mql2', 4),
  mov('agendada', 'mql2', 58),
  mov('agendada', 'noshow', 11),
  mov('agendada', 'proposta', 5),
  mov('agendada', 'mql1', 1),
  mov('mql2', 'proposta', 32),
  mov('mql2', 'noshow', 9),
  mov('mql2', 'agendada', 6),
  mov('mql2', 'contrato', 1),
  mov('noshow', 'agendada', 4),
  mov('noshow', 'mql2', 2),
  mov('proposta', 'contrato', 7),
  mov('proposta', 'agendada', 3),
  mov('perdido', 'agendada', 4),
];

const de = (id: string) => ETAPAS.find((e) => e.id === id)!;
const recomendar = (id: string, movimentos: Movimento[] | null = MOVIMENTOS) =>
  recomendarEtapas(de(id), ETAPAS, movimentos);

describe('recomendarEtapas — automático', () => {
  it('Reunião Agendada → MQL 2, com No Show e Proposta nos links (o exemplo do operador)', () => {
    expect(recomendar('agendada')).toEqual({
      principal: 'mql2',
      outras: ['noshow', 'proposta'],
      origem: 'automatico',
    });
  });

  it('só PARA A FRENTE: de MQL 2 não sugere voltar para Reunião Agendada', () => {
    // ⚠️ A razão de a primeira versão ter voltado: 6 movimentos para trás em
    // 30 dias, e o operador — "dificilmente ocorreria".
    const r = recomendar('mql2');
    expect(r).toEqual({ principal: 'proposta', outras: ['noshow'], origem: 'automatico' });
    expect(emLista(r)).not.toContain('agendada');
  });

  it(`um movimento só é ruído: abaixo de ${MINIMO_DE_MOVIMENTOS}, não entra`, () => {
    expect(recomendar('avulso')).toEqual({
      principal: 'mql1',
      outras: ['agendada'],
      origem: 'automatico',
    });
    // MQL 2 → Contrato Fechado aconteceu uma vez.
    expect(emLista(recomendar('mql2'))).not.toContain('contrato');
  });

  it('sem movimento para a frente, não recomenda nada (No Show só volta)', () => {
    expect(recomendar('noshow')).toBeNull();
    expect(recomendar('sem-proposta')).toBeNull();
  });

  it('etapa de ganho ou de perda não recomenda nada no automático', () => {
    expect(recomendar('contrato')).toBeNull();
    // "Perdido → Reunião Agendada" existe (4), mas é para trás e a etapa é de perda.
    expect(recomendar('perdido')).toBeNull();
    expect(recomendar('desqualificado')).toBeNull();
  });

  it('etapa de perda nunca vira o botão principal: vai para os links, depois das outras', () => {
    const movimentos = [mov('proposta', 'perdido', 20), mov('proposta', 'contrato', 7)];
    expect(recomendar('proposta', movimentos)).toEqual({
      principal: 'contrato',
      outras: ['perdido'],
      origem: 'automatico',
    });
  });

  it('só perda para a frente: sem botão principal, só o link', () => {
    expect(recomendar('proposta', [mov('proposta', 'perdido', 3)])).toEqual({
      principal: null,
      outras: ['perdido'],
      origem: 'automatico',
    });
  });

  it(`no máximo ${MAXIMO_DE_OPCOES} opções, e empate vai para a etapa mais perto`, () => {
    const movimentos = [
      mov('avulso', 'proposta', 5),
      mov('avulso', 'mql1', 5),
      mov('avulso', 'agendada', 5),
      mov('avulso', 'mql2', 5),
    ];
    expect(emLista(recomendar('avulso', movimentos))).toEqual(['mql1', 'agendada', 'mql2']);
  });

  it('sem os movimentos (carregando ou falhou), o automático não afirma nada', () => {
    expect(recomendar('agendada', null)).toBeNull();
  });

  it('etapa de outro funil ou apagada não entra', () => {
    const outroFunil: EtapaDoFunil = { id: 'juridico', pipeline_id: 'outro', position: 9 };
    const movimentos = [mov('agendada', 'juridico', 50), mov('agendada', 'sumiu', 40), mov('agendada', 'mql2', 3)];
    expect(recomendarEtapas(de('agendada'), [...ETAPAS, outroFunil], movimentos)).toEqual({
      principal: 'mql2',
      outras: [],
      origem: 'automatico',
    });
  });
});

describe('recomendarEtapas — escolha à mão (Gerenciar funil)', () => {
  const comEscolha = (id: string, proximas: string[] | null) => ({ ...de(id), proximas_etapas: proximas });

  it('vale a ordem gravada, inclusive para trás e perda como principal', () => {
    expect(recomendarEtapas(comEscolha('noshow', ['agendada', 'perdido']), ETAPAS, MOVIMENTOS)).toEqual({
      principal: 'agendada',
      outras: ['perdido'],
      origem: 'manual',
    });
  });

  it('não precisa dos movimentos', () => {
    expect(recomendarEtapas(comEscolha('noshow', ['agendada']), ETAPAS, null)?.principal).toBe('agendada');
  });

  it('lista vazia = nenhuma: o botão some, mesmo com automático possível', () => {
    expect(recomendarEtapas(comEscolha('agendada', []), ETAPAS, MOVIMENTOS)).toBeNull();
  });

  it('vale também em etapa de ganho ou perda', () => {
    expect(recomendarEtapas(comEscolha('perdido', ['lead']), ETAPAS, MOVIMENTOS)?.principal).toBe('lead');
  });

  it('ignora id órfão, de outro funil, repetido e a própria etapa; corta no máximo', () => {
    const outroFunil: EtapaDoFunil = { id: 'juridico', pipeline_id: 'outro', position: 1 };
    const escolha = comEscolha('agendada', ['sumiu', 'agendada', 'juridico', 'mql2', 'mql2', 'noshow', 'proposta', 'contrato']);
    expect(recomendarEtapas(escolha, [...ETAPAS, outroFunil], MOVIMENTOS)).toEqual({
      principal: 'mql2',
      outras: ['noshow', 'proposta'],
      origem: 'manual',
    });
  });

  it('escolha só com etapas apagadas = nenhuma (não volta ao automático sozinha)', () => {
    expect(recomendarEtapas(comEscolha('agendada', ['sumiu']), ETAPAS, MOVIMENTOS)).toBeNull();
  });
});

describe('emLista', () => {
  it('principal primeiro; sem principal, só os links; nada = vazio', () => {
    expect(emLista({ principal: 'a', outras: ['b'], origem: 'automatico' })).toEqual(['a', 'b']);
    expect(emLista({ principal: null, outras: ['b'], origem: 'automatico' })).toEqual(['b']);
    expect(emLista(null)).toEqual([]);
  });
});
