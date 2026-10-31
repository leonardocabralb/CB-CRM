import { describe, expect, it } from 'vitest';

import { destinoDaEdicao, idDoAvisoDeApagada, quandoFoiEditada } from './edicao';

// ============================================================
// A edição da anotação na tela (Fase 3): quando ela continua, quando acaba e
// quando o fim é "apagada" (o aviso).
// ============================================================

const A = 'conversa-a';
const B = 'conversa-b';
const NOTA = 'nota-1';
const OUTRA = 'nota-2';
const edicao = { de: A, id: NOTA };

describe('destinoDaEdicao', () => {
  it('sem edição, nada', () => {
    expect(destinoDaEdicao(null, A, [{ id: NOTA }], true)).toEqual({
      editandoId: null,
      soltar: false,
      apagada: null,
    });
  });

  it('na conversa em que começou e com a nota na lista: continua', () => {
    expect(destinoDaEdicao(edicao, A, [{ id: OUTRA }, { id: NOTA }], true)).toEqual({
      editandoId: NOTA,
      soltar: false,
      apagada: null,
    });
    // Recarregando (lista ainda não respondida), mas com a nota lá: continua.
    expect(destinoDaEdicao(edicao, A, [{ id: NOTA }], false).editandoId).toBe(NOTA);
  });

  it('trocou de conversa: acaba, sem aviso — e não reabre na volta (A → B → A)', () => {
    expect(destinoDaEdicao(edicao, B, [], true)).toEqual({
      editandoId: null,
      soltar: true,
      apagada: null,
    });
  });

  it('a nota saiu da lista RESPONDIDA: acaba, com o aviso de apagada', () => {
    expect(destinoDaEdicao(edicao, A, [{ id: OUTRA }], true)).toEqual({
      editandoId: null,
      soltar: true,
      apagada: NOTA,
    });
  });

  it('a lista esvaziou por uma busca que FALHOU: acaba (senão a recarga boa a reabriria sozinha), sem o aviso', () => {
    expect(destinoDaEdicao(edicao, A, [], false)).toEqual({
      editandoId: null,
      soltar: true,
      apagada: null,
    });
  });
});

describe('idDoAvisoDeApagada', () => {
  it('um id por nota — o hook e a caixa juntam o mesmo aviso', () => {
    expect(idDoAvisoDeApagada(NOTA)).toBe(idDoAvisoDeApagada(NOTA));
    expect(idDoAvisoDeApagada(NOTA)).not.toBe(idDoAvisoDeApagada(OUTRA));
  });
});

describe('quandoFoiEditada (a hora visível ao lado da marca "editada")', () => {
  // Fuso e locale fixos: a tela usa os do navegador, e o teste não pode
  // depender da máquina (o CI roda em UTC).
  const BRASIL = { locale: 'pt-BR', timeZone: 'America/Sao_Paulo' };

  it('editada no mesmo dia em que foi escrita: só a hora', () => {
    expect(quandoFoiEditada('2026-10-23T23:02:00Z', '2026-10-23T22:59:00Z', BRASIL)).toBe('20:02');
  });

  it('o "mesmo dia" é o do fuso de quem lê, não o do UTC', () => {
    // 20:30 e 22:00 em Brasília (23/10): no UTC já seriam dias diferentes.
    expect(quandoFoiEditada('2026-10-24T01:00:00Z', '2026-10-23T23:30:00Z', BRASIL)).toBe('22:00');
    // 21:30 de 23/10 e 00:10 de 24/10 em Brasília: dias diferentes, o mesmo dia no UTC.
    expect(quandoFoiEditada('2026-10-24T03:10:00Z', '2026-10-24T00:30:00Z', BRASIL)).toBe('24/10, 00:10');
  });

  it('noutro dia do mesmo ano: dia, mês e hora', () => {
    expect(quandoFoiEditada('2026-10-24T12:15:00Z', '2026-10-23T22:59:00Z', BRASIL)).toBe('24/10, 09:15');
  });

  it('noutro ano, ou sem a data de criação: com o ano', () => {
    expect(quandoFoiEditada('2027-01-05T13:00:00Z', '2026-12-30T13:00:00Z', BRASIL)).toBe('05/01/2027, 10:00');
    expect(quandoFoiEditada('2026-10-24T12:15:00Z', null, BRASIL)).toBe('24/10/2026, 09:15');
  });

  it('instante ilegível: nada (a marca não aparece)', () => {
    expect(quandoFoiEditada('não é data', '2026-10-23T22:59:00Z', BRASIL)).toBeNull();
  });
});
