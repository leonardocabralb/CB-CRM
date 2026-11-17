import { describe, expect, it } from 'vitest';

import { paginaQueExiste } from './pagina-que-existe';

describe('paginaQueExiste (porte #679)', () => {
  it('com o total exato, vai direto para a última página que existe', () => {
    // A 3ª página (2) esvaziou: sobraram 50 fichas = 2 páginas.
    expect(paginaQueExiste(2, 50, 25)).toBe(1);
    // Sobraram 26: a 2ª página (1) ainda existe.
    expect(paginaQueExiste(4, 26, 25)).toBe(1);
    // Tudo saiu: a primeira.
    expect(paginaQueExiste(3, 0, 25)).toBe(0);
  });

  it('sem o total (PGRST103, filtro por etiqueta), volta uma página por vez', () => {
    expect(paginaQueExiste(3, null, 25)).toBe(2);
    expect(paginaQueExiste(1, null, 25)).toBe(0);
  });

  it('⚠️ a página 0 nunca volta: o vazio ali é "nenhum contato" de verdade', () => {
    expect(paginaQueExiste(0, 0, 25)).toBe(0);
    expect(paginaQueExiste(0, null, 25)).toBe(0);
  });

  it('⚠️ a contagem que diz que a página existe faz FICAR (quem chama não pede de novo)', () => {
    // Lista vazia com total que cobre a página: corrida. Devolver a mesma
    // página é o que impede o laço.
    expect(paginaQueExiste(1, 60, 25)).toBe(1);
  });
});
