import { describe, expect, it } from 'vitest';

import type { ReuniaoDaPauta, RegistroDoResultado, Resultado } from './pauta';
import { funilNoInstante, lerResumoDeReunioes, reunioesDoResumo, type PassoDeFunil } from './resumo';

// Dados fictícios.
const COMERCIAL = 'funil-comercial';
const JURIDICO = 'funil-juridico';

function passo(id: string, em: string, funil: string | null): PassoDeFunil {
  return { id, em, funil };
}

function resultado(tipo: Resultado): RegistroDoResultado {
  return { tipo, valor: null, em: '2026-10-01T14:30:00Z', por: 'Ana', fonte: 'tela', etapa: null };
}

function reuniao(inicio: string, negocioId: string | null, res: Resultado | null): ReuniaoDaPauta {
  return {
    chave: `calendly:${inicio}`,
    origem: 'calendly',
    reuniaoId: inicio,
    inicio,
    fim: null,
    evento: 'Reunião',
    link: null,
    reagendamento: false,
    remarcadaDe: null,
    proximaEm: null,
    anteriorEm: null,
    contato: { id: 'contato-1', nome: 'Cliente Fictício' },
    conversaId: null,
    negocio: negocioId
      ? {
          id: negocioId,
          // O funil de HOJE: o resumo não pode usá-lo.
          pipelineId: JURIDICO,
          pipelineNome: 'Jurídico',
          etapaId: 'etapa-x',
          etapaNome: 'X',
          valor: 0,
          status: 'open',
        }
      : null,
    qualificacao: { divida: null, atraso: null, origem: null },
    qualificada: null,
    resultado: res ? resultado(res) : null,
    faltouAntes: null,
    aguardandoDesde: null,
  };
}

describe('funilNoInstante', () => {
  const passos = [
    passo('a1', '2026-10-01T10:00:00Z', COMERCIAL),
    passo('a2', '2026-10-01T11:00:00Z', COMERCIAL),
    passo('a3', '2026-10-05T09:00:00Z', JURIDICO),
  ];

  it('o funil da última entrada ATÉ o instante — o transferido depois conta no de origem', () => {
    expect(funilNoInstante(passos, '2026-10-02T14:00:00Z')).toBe(COMERCIAL);
    expect(funilNoInstante(passos, '2026-10-06T14:00:00Z')).toBe(JURIDICO);
  });

  it('a entrada NO instante conta (até, inclusive)', () => {
    expect(funilNoInstante(passos, '2026-10-05T09:00:00Z')).toBe(JURIDICO);
    expect(funilNoInstante(passos, '2026-10-05T09:00:00.000+00:00')).toBe(JURIDICO);
  });

  it('nenhuma entrada até o instante → nulo (fora de funil), nunca o funil de hoje', () => {
    expect(funilNoInstante(passos, '2026-09-30T10:00:00Z')).toBeNull();
    expect(funilNoInstante([], '2026-10-02T14:00:00Z')).toBeNull();
  });

  it('a ordem da lista não importa; empate de instante desempata pelo id (a ordem da RPC do funil)', () => {
    const embaralhados = [passos[2], passos[0], passos[1]];
    expect(funilNoInstante(embaralhados, '2026-10-02T14:00:00Z')).toBe(COMERCIAL);
    const empate = [passo('b2', '2026-10-01T10:00:00Z', JURIDICO), passo('b1', '2026-10-01T10:00:00Z', COMERCIAL)];
    expect(funilNoInstante(empate, '2026-10-01T12:00:00Z')).toBe(JURIDICO);
    expect(funilNoInstante([...empate].reverse(), '2026-10-01T12:00:00Z')).toBe(JURIDICO);
  });

  it('instante ilegível → nulo; passo com data ilegível é ignorado', () => {
    expect(funilNoInstante(passos, 'não é data')).toBeNull();
    expect(funilNoInstante([passo('c1', 'lixo', JURIDICO), ...passos], '2026-10-02T14:00:00Z')).toBe(COMERCIAL);
  });
});

describe('reunioesDoResumo', () => {
  const AGORA = new Date('2026-10-09T15:00:00Z');
  const passosPorNegocio = new Map<string, PassoDeFunil[]>([
    ['negocio-1', [passo('p1', '2026-09-20T10:00:00Z', COMERCIAL), passo('p2', '2026-10-07T10:00:00Z', JURIDICO)]],
  ]);

  it('o funil é o do card NO INÍCIO da reunião, nunca o de hoje', () => {
    const [r] = reunioesDoResumo([reuniao('2026-10-02T14:00:00Z', 'negocio-1', 'proposta')], passosPorNegocio, AGORA);
    expect(r).toEqual({ inicio: '2026-10-02T14:00:00Z', funil: COMERCIAL, resultado: 'proposta' });
  });

  it('só as que JÁ COMEÇARAM: a futura fica de fora mesmo com o Reagendar gravado antes do horário', () => {
    const linhas = reunioesDoResumo(
      [
        reuniao('2026-10-09T15:00:00Z', 'negocio-1', null),
        reuniao('2026-10-09T16:00:00Z', 'negocio-1', 'reagendar'),
      ],
      passosPorNegocio,
      AGORA,
    );
    expect(linhas.map((l) => l.inicio)).toEqual(['2026-10-09T15:00:00Z']);
  });

  it('sem card, ou card sem passo até o início → funil nulo; sem resultado → resultado nulo', () => {
    const linhas = reunioesDoResumo(
      [reuniao('2026-10-02T14:00:00Z', null, 'no_show'), reuniao('2026-10-02T15:00:00Z', 'negocio-sem-passo', null)],
      passosPorNegocio,
      AGORA,
    );
    expect(linhas).toEqual([
      { inicio: '2026-10-02T14:00:00Z', funil: null, resultado: 'no_show' },
      { inicio: '2026-10-02T15:00:00Z', funil: null, resultado: null },
    ]);
  });

  it('a linha não leva NADA do cliente (nome, contato, card, valor)', () => {
    const [r] = reunioesDoResumo([reuniao('2026-10-02T14:00:00Z', 'negocio-1', 'sem_proposta')], passosPorNegocio, AGORA);
    expect(Object.keys(r).sort()).toEqual(['funil', 'inicio', 'resultado']);
  });
});

describe('lerResumoDeReunioes', () => {
  it('aceita a forma da rota', () => {
    const corpo = {
      reunioes: [
        { inicio: '2026-10-02T14:00:00Z', funil: COMERCIAL, resultado: 'proposta' },
        { inicio: '2026-10-02T15:00:00Z', funil: null, resultado: null },
      ],
    };
    expect(lerResumoDeReunioes(corpo)).toEqual(corpo.reunioes);
    expect(lerResumoDeReunioes({ reunioes: [] })).toEqual([]);
  });

  it('forma estranha → nulo ("não sei"), nunca lista vazia', () => {
    expect(lerResumoDeReunioes(null)).toBeNull();
    expect(lerResumoDeReunioes({})).toBeNull();
    expect(lerResumoDeReunioes({ error: 'db_error' })).toBeNull();
    expect(lerResumoDeReunioes({ reunioes: [{ inicio: 'lixo', funil: null, resultado: null }] })).toBeNull();
    expect(lerResumoDeReunioes({ reunioes: [{ inicio: '2026-10-02T14:00:00Z', funil: 7, resultado: null }] })).toBeNull();
    expect(lerResumoDeReunioes({ reunioes: [{ inicio: '2026-10-02T14:00:00Z', funil: null, resultado: 'faltou' }] })).toBeNull();
    expect(lerResumoDeReunioes({ reunioes: [{ inicio: '2026-10-02T14:00:00Z', funil: null }] })).toBeNull();
  });
});
