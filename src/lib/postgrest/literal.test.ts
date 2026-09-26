import { describe, expect, it } from 'vitest';

import {
  entreAspasDoPostgrest,
  escaparLike,
  literalParaRegex,
  ramoContem,
} from './literal';

// ============================================================
// O que o PostgREST faz com o valor, imitado AQUI só para conferir a ida e
// a volta: dentro das aspas, `\x` vira `x` (é a regra da árvore do `.or()`),
// e o `imatch` vira `~*` sobre o que sobrou. Os dois casos que importam
// foram MEDIDOS contra o PostgREST real na verificação do PR (ver o
// comentário do módulo); este teste pina a forma da string.
// ============================================================

/** O que o PostgREST entrega ao operador a partir de `"…"`. */
function desfazerAspas(valor: string): string {
  expect(valor.startsWith('"') && valor.endsWith('"')).toBe(true);
  return valor.slice(1, -1).replace(/\\([\s\S])/g, '$1');
}

/** O ramo `coluna.imatch."…"` aplicado a um texto, como o `~*` faria. */
function casa(ramo: string, texto: string): boolean {
  const m = /^[a-z_]+\.imatch\.([\s\S]*)$/.exec(ramo);
  expect(m).not.toBeNull();
  return new RegExp(desfazerAspas(m![1]), 'iu').test(texto);
}

describe('ramoContem', () => {
  it('monta o ramo com imatch e aspas', () => {
    expect(ramoContem('name', 'ana')).toBe('name.imatch."ana"');
  });

  it.each([
    // [termo, texto que TEM de casar, texto que NÃO pode casar]
    ['silva, jr', 'Ana Silva, Jr.', 'Ana Silva Jr'],
    ['(83) 9887', 'Fone (83) 98874-5316', 'Fone 83 98874'],
    ['50%', 'Desconto de 50%', 'Desconto de 500'],
    ['a_b', 'x a_b y', 'x aXb y'],
    ['a*b', 'x a*b y', 'x aXXb y'],
    ['o"brien', 'Ana O"Brien', 'Ana OBrien'],
    ['a\\b', 'pasta a\\b', 'pasta ab'],
    ['c:d.e', 'c:d.e', 'cXdXe'],
    ['[x]{2}', 'lista [x]{2}', 'lista xx'],
  ])('%j casa só o texto literal', (termo, sim, nao) => {
    const ramo = ramoContem('name', termo);
    expect(casa(ramo, sim)).toBe(true);
    expect(casa(ramo, nao)).toBe(false);
  });

  it('ignora a caixa, como o ilike que substitui', () => {
    expect(casa(ramoContem('name', 'BANCÁRIO'), 'Cliente bancário')).toBe(true);
  });

  it('a aspa e a barra NUNCA fecham o valor antes da hora', () => {
    // Depois de desfazer as aspas, tem de sobrar a regex inteira: uma aspa
    // sem barra na frente encerraria o valor no meio do `.or()`.
    const valor = entreAspasDoPostgrest('a"b\\c');
    expect(valor).toBe('"a\\"b\\\\c"');
    expect(desfazerAspas(valor)).toBe('a"b\\c');
  });
});

describe('literalParaRegex', () => {
  it('o escape cobre todo metacaractere da expressão regular', () => {
    const tudo = '\\^$.|?*+()[]{}';
    expect(new RegExp(`^${literalParaRegex(tudo)}$`, 'u').test(tudo)).toBe(true);
    expect(literalParaRegex('São Paulo - a/b #1')).toBe('São Paulo - a/b #1');
  });
});

describe('escaparLike', () => {
  it.each([
    ['50%', '50\\%'],
    ['a_b', 'a\\_b'],
    ['a\\b', 'a\\\\b'],
    // O `*` fica: no LIKE escrito no banco ele já é literal.
    ['a*b', 'a*b'],
    ['silva, jr', 'silva, jr'],
  ])('%j → %j', (termo, esperado) => {
    expect(escaparLike(termo)).toBe(esperado);
  });

  it('com o escape, o LIKE casa só o texto literal', () => {
    // O LIKE do Postgres com o escape padrão `\`, imitado em JS.
    const like = (padrao: string, texto: string) => {
      let re = '';
      for (let i = 0; i < padrao.length; i++) {
        const c = padrao[i];
        if (c === '\\') re += literalParaRegex(padrao[++i] ?? '');
        else if (c === '%') re += '.*';
        else if (c === '_') re += '.';
        else re += literalParaRegex(c);
      }
      return new RegExp(`^${re}$`, 'isu').test(texto);
    };
    const contem = (termo: string, texto: string) => like(`%${escaparLike(termo)}%`, texto);
    expect(contem('50%', 'Desconto de 50%')).toBe(true);
    expect(contem('50%', 'Desconto de 500')).toBe(false);
    expect(contem('a_b', 'x aXb y')).toBe(false);
    expect(contem('a\\b', 'pasta a\\b')).toBe(true);
  });
});
