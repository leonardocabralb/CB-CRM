import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Chave REPETIDA no mesmo objeto de um dicionário. O `JSON.parse` fica com
// a ÚLTIMA ocorrência e não avisa nada — e os três portões de i18n (a
// paridade, as chaves usadas e o `messages.test.ts`) leem os arquivos com
// ele, então passam verdes por cima.
//
// Já aconteceu (23/09/2026): o merge do upstream (#259) acrescentou no fim
// de `Contacts.importModal` as chaves do #529/#586 dele, e o PR #265
// acrescentou as SUAS no meio do mesmo objeto. O Git juntou os dois sem
// conflito (os trechos não se tocavam) e as do #259 venciam: o texto com
// plural ICU do #265 ficava morto, e a tela diria "3 telefone inválido".
// Achado pela auditoria do #259, não por teste nenhum.
// ============================================================

/** As chaves repetidas, com o caminho do objeto e as duas linhas. */
export function chavesRepetidas(texto: string): string[] {
  type Quadro = { tipo: 'obj'; chaves: Map<string, number>; caminho: string; ultima: string | null; esperaChave: boolean } | { tipo: 'arr'; caminho: string };
  const achadas: string[] = [];
  const pilha: Quadro[] = [];
  let linha = 1;
  let i = 0;

  const caminhoDoFilho = (): string => {
    const topo = pilha.at(-1);
    if (!topo) return '';
    if (topo.tipo === 'arr') return `${topo.caminho}[]`;
    return topo.caminho ? `${topo.caminho}.${topo.ultima}` : String(topo.ultima);
  };

  while (i < texto.length) {
    const c = texto[i];
    if (c === '\n') {
      linha++;
      i++;
    } else if (c === '{') {
      pilha.push({ tipo: 'obj', chaves: new Map(), caminho: caminhoDoFilho(), ultima: null, esperaChave: true });
      i++;
    } else if (c === '[') {
      pilha.push({ tipo: 'arr', caminho: caminhoDoFilho() });
      i++;
    } else if (c === '}' || c === ']') {
      pilha.pop();
      i++;
    } else if (c === ',') {
      const topo = pilha.at(-1);
      if (topo?.tipo === 'obj') topo.esperaChave = true;
      i++;
    } else if (c === ':') {
      const topo = pilha.at(-1);
      if (topo?.tipo === 'obj') topo.esperaChave = false;
      i++;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      while (texto[j] !== '"') {
        if (texto[j] === '\\') {
          s += texto[j] + texto[j + 1];
          j += 2;
        } else {
          s += texto[j++];
        }
      }
      i = j + 1;
      const topo = pilha.at(-1);
      if (topo?.tipo === 'obj' && topo.esperaChave) {
        const onde = topo.caminho ? `${topo.caminho}.${s}` : s;
        const antes = topo.chaves.get(s);
        if (antes !== undefined) achadas.push(`${onde} (linhas ${antes} e ${linha})`);
        else topo.chaves.set(s, linha);
        topo.ultima = s;
      }
    } else {
      i++;
    }
  }
  return achadas;
}

describe('chavesRepetidas (o detector)', () => {
  it('acha a repetida no mesmo objeto, com o caminho e as linhas', () => {
    const texto = '{\n "A": {\n  "x": "1",\n  "y": "2",\n  "x": "3"\n }\n}';
    expect(chavesRepetidas(texto)).toEqual(['A.x (linhas 3 e 5)']);
  });

  it('a mesma chave em objetos DIFERENTES não é repetição', () => {
    expect(chavesRepetidas('{"A": {"x": "1"}, "B": {"x": "2"}}')).toEqual([]);
  });

  it('não confunde valor com chave, nem aspas escapadas', () => {
    expect(chavesRepetidas('{"a": "a", "b": "diz \\"a\\"", "c": ["a", "a"]}')).toEqual([]);
  });
});

describe('os dicionários não têm chave repetida', () => {
  const dir = path.join(__dirname, '../../messages');
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

  it('há dicionários a conferir', () => {
    expect(arquivos).toEqual(expect.arrayContaining(['en.json', 'pt-BR.json']));
  });

  it.each(arquivos)('%s', (arquivo) => {
    expect(chavesRepetidas(fs.readFileSync(path.join(dir, arquivo), 'utf8'))).toEqual([]);
  });
});
