import { describe, expect, it } from 'vitest';

import {
  DIAS_NA_LIXEIRA_DE_ANOTACOES,
  diasParaVencer,
  estaApagada,
  limiteDoVencimento,
  naOrdemDaLixeira,
  podeMexerNaNota,
} from './lixeira';

const DIA = 24 * 60 * 60 * 1000;
const AGORA = Date.parse('2026-11-10T15:00:00Z');

describe('lixeira de anotações (1132): as regras puras', () => {
  it('o prazo é o da Lixeira de contatos (decisão do operador)', () => {
    expect(DIAS_NA_LIXEIRA_DE_ANOTACOES).toBe(90);
  });

  it('apagada = `apagada_em` preenchido; ausente (app antigo, tempo real sem a coluna) é VIVA', () => {
    expect(estaApagada({ apagada_em: '2026-11-10T12:00:00Z' })).toBe(true);
    expect(estaApagada({ apagada_em: null })).toBe(false);
    expect(estaApagada({})).toBe(false);
    expect(estaApagada({ apagada_em: '' })).toBe(false);
  });

  it('apaga e restaura o AUTOR ou admin/dono; sem autor (automação, IA), só admin', () => {
    expect(podeMexerNaNota({ author_user_id: 'ana' }, 'ana', false)).toBe(true);
    expect(podeMexerNaNota({ author_user_id: 'ana' }, 'bia', false)).toBe(false);
    expect(podeMexerNaNota({ author_user_id: 'ana' }, 'bia', true)).toBe(true);
    expect(podeMexerNaNota({ author_user_id: null }, 'bia', false)).toBe(false);
    expect(podeMexerNaNota({ author_user_id: null }, 'bia', true)).toBe(true);
    // Sem login conhecido, só o admin (nunca `null === null`).
    expect(podeMexerNaNota({ author_user_id: null }, null, false)).toBe(false);
  });

  it('vence a apagada há mais de 90 dias', () => {
    expect(limiteDoVencimento(AGORA)).toBe(new Date(AGORA - 90 * DIA).toISOString());
  });

  it('dias para sair da lixeira: conta para cima, nunca negativo, e cala com data ilegível', () => {
    expect(diasParaVencer(new Date(AGORA).toISOString(), AGORA)).toBe(90);
    expect(diasParaVencer(new Date(AGORA - 89.5 * DIA).toISOString(), AGORA)).toBe(1);
    expect(diasParaVencer(new Date(AGORA - 120 * DIA).toISOString(), AGORA)).toBe(0);
    expect(diasParaVencer('ontem', AGORA)).toBeNull();
  });

  it('a ordem é a da ESCRITA, a mais recente em cima (a da aba Notas), e não muda a lista recebida', () => {
    const lista = [
      { id: 'b', created_at: '2026-11-01T10:00:00Z' },
      { id: 'c', created_at: '2026-11-05T10:00:00Z' },
      { id: 'a', created_at: '2026-11-01T10:00:00Z' },
    ];
    expect(naOrdemDaLixeira(lista).map((n) => n.id)).toEqual(['c', 'a', 'b']);
    expect(lista.map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });
});
