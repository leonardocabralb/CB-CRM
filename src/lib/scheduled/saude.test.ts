import { describe, expect, it } from 'vitest';

import { CICLO_MINUTOS } from './display';
import { avaliarAgendador, deveAparecer, TOLERANCIA_MINUTOS } from './saude';

const AGORA = new Date('2026-08-02T12:00:00.000Z');
/** Um carimbo de N minutos atrás, em ISO. */
const atras = (min: number) =>
  new Date(AGORA.getTime() - min * 60_000).toISOString();

describe('avaliarAgendador', () => {
  it('ciclo recente e nada falhando = silêncio', () => {
    const s = avaliarAgendador({
      ultimoCiclo: atras(3),
      pendentes: 4,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.tom).toBe('ok');
    expect(s.recado).toBeNull();
    expect(deveAparecer(s)).toBe(false);
  });

  it('⚠️ parado COM fila é VERMELHO — há mensagem de cliente que não vai sair', () => {
    const s = avaliarAgendador({
      ultimoCiclo: atras(TOLERANCIA_MINUTOS + 1),
      pendentes: 2,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.tom).toBe('down');
    expect(s.recado).toBe('paradoComFila');
    expect(deveAparecer(s)).toBe(true);
  });

  it('parado SEM fila é âmbar — nada em risco agora, mas avisa antes', () => {
    const s = avaliarAgendador({
      ultimoCiclo: atras(TOLERANCIA_MINUTOS + 1),
      pendentes: 0,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.tom).toBe('warn');
    expect(s.recado).toBe('paradoSemFila');
  });

  it('⚠️ o carimbo semeado pela 927 significa NUNCA RODOU, não dado inválido', () => {
    const s = avaliarAgendador({
      ultimoCiclo: '1970-01-01T00:00:00.000Z',
      pendentes: 0,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.recado).toBe('nuncaRodou');
    expect(s.minutosSemCiclo).toBeNull();
  });

  it('nunca rodou COM fila continua sendo vermelho', () => {
    const s = avaliarAgendador({
      ultimoCiclo: '1970-01-01T00:00:00.000Z',
      pendentes: 1,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.tom).toBe('down');
    expect(s.recado).toBe('paradoComFila');
  });

  it('linha sumida ou carimbo ilegível não viram "tudo certo"', () => {
    for (const ruim of [null, 'nao-e-data']) {
      const s = avaliarAgendador({
        ultimoCiclo: ruim,
        pendentes: 0,
        falhas: 0,
        agora: AGORA,
      });
      expect(s.tom).not.toBe('ok');
      expect(s.recado).toBe('nuncaRodou');
    }
  });

  it('⚠️ UM ciclo perdido NÃO acusa — alarme falso treina a ignorar o aviso', () => {
    const s = avaliarAgendador({
      ultimoCiclo: atras(CICLO_MINUTOS + 1),
      pendentes: 5,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.tom).toBe('ok');
    expect(s.recado).toBeNull();
  });

  it('a fronteira é exatamente a tolerância', () => {
    const dentro = avaliarAgendador({
      ultimoCiclo: atras(TOLERANCIA_MINUTOS),
      pendentes: 1,
      falhas: 0,
      agora: AGORA,
    });
    expect(dentro.recado).toBeNull();
    const fora = avaliarAgendador({
      ultimoCiclo: atras(TOLERANCIA_MINUTOS + 1),
      pendentes: 1,
      falhas: 0,
      agora: AGORA,
    });
    expect(fora.recado).toBe('paradoComFila');
  });

  it('agendador vivo mas com falhas acumuladas = âmbar', () => {
    const s = avaliarAgendador({
      ultimoCiclo: atras(2),
      pendentes: 0,
      falhas: 3,
      agora: AGORA,
    });
    expect(s.tom).toBe('warn');
    expect(s.recado).toBe('falhas');
    expect(s.falhas).toBe(3);
  });

  it('⚠️ agendador PARADO tem precedência sobre falhas', () => {
    // As falhas antigas são consequência; o agendador parado é a causa, e é
    // o que o operador precisa resolver primeiro.
    const s = avaliarAgendador({
      ultimoCiclo: atras(TOLERANCIA_MINUTOS + 60),
      pendentes: 2,
      falhas: 9,
      agora: AGORA,
    });
    expect(s.recado).toBe('paradoComFila');
  });

  it('relógio adiantado não vira minutos negativos', () => {
    const s = avaliarAgendador({
      ultimoCiclo: new Date(AGORA.getTime() + 60_000).toISOString(),
      pendentes: 0,
      falhas: 0,
      agora: AGORA,
    });
    expect(s.minutosSemCiclo).toBe(0);
    expect(s.tom).toBe('ok');
  });
});

describe('TOLERANCIA_MINUTOS', () => {
  it('acompanha o ciclo — mudar um sem o outro faria alarme falso', () => {
    expect(TOLERANCIA_MINUTOS).toBe(CICLO_MINUTOS * 2 + 5);
  });
});
