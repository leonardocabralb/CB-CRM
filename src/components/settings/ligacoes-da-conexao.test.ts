import { describe, expect, it } from 'vitest';

import { secaoDaConexao, type ComputadorNaTela, type ListaDasLigacoes } from './ligacoes-da-conexao';

// A seção "Ligações pelo CRM" da conexão (4e): o que ela afirma com a lista
// em cada estado. Dados fictícios.

const CANAL = 'canal-1';
const computador: ComputadorNaTela = {
  channel_id: CANAL,
  ligado: true,
  ligado_em: '2026-11-11T12:00:00.000Z',
  situacao: 'pronto',
  sinal_em: '2026-11-11T15:00:00.000Z',
};
const pronta = (porCanal: Map<string, ComputadorNaTela>, configurado = true): ListaDasLigacoes => ({
  estado: 'pronta',
  configurado,
  porCanal,
});

describe('secaoDaConexao', () => {
  it('⚠️ carregando ou que falhou NUNCA vira "não tem computador" (raiz, 8c)', () => {
    expect(secaoDaConexao({ estado: 'carregando' }, CANAL)).toEqual({ tipo: 'carregando' });
    expect(secaoDaConexao({ estado: 'falhou' }, CANAL)).toEqual({ tipo: 'falhou' });
  });

  it('com a resposta: o computador da conexão, ou a frase da D17', () => {
    expect(secaoDaConexao(pronta(new Map([[CANAL, computador]])), CANAL)).toEqual({ tipo: 'computador', computador });
    expect(secaoDaConexao(pronta(new Map([[CANAL, computador]])), 'outro')).toEqual({ tipo: 'sem_computador' });
  });

  it('quem não é admin, e a instalação sem as ligações, não veem a seção', () => {
    expect(secaoDaConexao({ estado: 'inativa' }, CANAL)).toEqual({ tipo: 'nada' });
    expect(secaoDaConexao(pronta(new Map(), false), CANAL)).toEqual({ tipo: 'nada' });
  });
});
