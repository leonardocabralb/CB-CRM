import { describe, expect, it } from 'vitest';

import { destinoDaEdicao, idDoAvisoDeApagada } from './edicao';

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
