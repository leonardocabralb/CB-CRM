import { describe, expect, it } from 'vitest';

import { quemAvisarDaResposta, type NotaDaConversa } from './resposta';

const nota = (
  id: string,
  author_user_id: string | null,
  resposta_de: string | null = null
): NotaDaConversa => ({ id, author_user_id, resposta_de });

describe('quemAvisarDaResposta', () => {
  it('a primeira resposta avisa o autor da original', () => {
    const notas = [nota('o', 'u-ana')];
    expect(quemAvisarDaResposta(notas, 'o', 'u-bia')).toEqual(['u-ana']);
  });

  it('quem responde nunca é avisado — nem respondendo à própria anotação', () => {
    const notas = [nota('o', 'u-ana')];
    expect(quemAvisarDaResposta(notas, 'o', 'u-ana')).toEqual([]);
  });

  it('o autor que responde de volta avisa quem já respondeu', () => {
    const notas = [nota('o', 'u-ana'), nota('r1', 'u-bia', 'o')];
    expect(quemAvisarDaResposta(notas, 'r1', 'u-ana')).toEqual(['u-bia']);
    expect(quemAvisarDaResposta(notas, 'o', 'u-ana')).toEqual(['u-bia']);
  });

  it('o autor do alvo vem primeiro, depois quem mais escreveu, sem repetir', () => {
    const notas = [
      nota('o', 'u-ana'),
      nota('r1', 'u-bia', 'o'),
      nota('r2', 'u-caio', 'r1'),
      nota('r3', 'u-bia', 'o'),
    ];
    expect(quemAvisarDaResposta(notas, 'r2', 'u-davi')).toEqual([
      'u-caio',
      'u-ana',
      'u-bia',
    ]);
  });

  it('não avisa quem escreveu noutra anotação da mesma conversa', () => {
    const notas = [
      nota('o', 'u-ana'),
      nota('outra', 'u-caio'),
      nota('r-outra', 'u-davi', 'outra'),
    ];
    expect(quemAvisarDaResposta(notas, 'o', 'u-bia')).toEqual(['u-ana']);
  });

  it('quem foi mencionado nesta resposta não recebe um segundo aviso', () => {
    const notas = [nota('o', 'u-ana'), nota('r1', 'u-bia', 'o')];
    expect(quemAvisarDaResposta(notas, 'o', 'u-caio', ['u-ana'])).toEqual([
      'u-bia',
    ]);
  });

  it('autor que saiu da conta (nulo) fica de fora', () => {
    const notas = [nota('o', null), nota('r1', 'u-bia', 'o')];
    expect(quemAvisarDaResposta(notas, 'o', 'u-caio')).toEqual(['u-bia']);
  });

  it('original apagada (resposta_de nulo) corta a conversa ali', () => {
    // r1 respondia a uma original apagada; r2 responde a r1.
    const notas = [nota('r1', 'u-bia'), nota('r2', 'u-caio', 'r1')];
    expect(quemAvisarDaResposta(notas, 'r2', 'u-davi')).toEqual([
      'u-caio',
      'u-bia',
    ]);
  });

  it('um ciclo escrito à mão no banco não trava a subida', () => {
    const notas = [nota('a', 'u-ana', 'b'), nota('b', 'u-bia', 'a')];
    expect(quemAvisarDaResposta(notas, 'a', 'u-caio')).toContain('u-ana');
  });
});
