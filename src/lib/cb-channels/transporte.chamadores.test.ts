import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A comparação crua com o transporte é PROIBIDA fora de `transporte.ts`.
//
// `kind === 'evolution'` com um `else` que significa "Meta" foi o desenho
// de toda a base enquanto havia dois transportes. Medido antes do terceiro
// entrar: o TypeScript aceita a comparação para sempre, então acrescentar
// `'instagram'` ao tipo deixava ~50 ramos intactos — e cada `else` passava a
// tratar um canal Instagram como WhatsApp Cloud API, sem erro nenhum. Este
// teste faz o que o compilador não faz: lê o fonte e reprova a forma.
//
// O que ele NÃO cobre, de propósito: `switch (x.kind)` — um switch sobre
// o tipo `Transporte` é conferível pelo compilador (todo caso coberto, ou
// `default` que lança), e `transport/index.ts` usa essa forma. E
// `.eq('kind', 'evolution')` de consulta ao banco: aquilo é filtro, não
// decisão de ramo.
// ============================================================

const raiz = path.join(__dirname, '..', '..');

/** O único arquivo autorizado a comparar com o literal. */
const AUTORIZADO = path.join(raiz, 'lib', 'cb-channels', 'transporte.ts');

const FORMAS = [
  // x.kind === 'meta' · c?.provider !== "evolution" · channelKind == `instagram`
  // (`[\w$]*` + `/i`: pega `channelKind`, `providerName`, `KIND` — o nome do
  // campo varia, e foi um `channelKind` que a primeira versão deixou passar)
  /[\w$]*(kind|provider)\s*(===|!==|==|!=)\s*['"`](meta|evolution|instagram)['"`]/i,
  // 'meta' === x.kind (a forma invertida)
  /['"`](meta|evolution|instagram)['"`]\s*(===|!==|==|!=)\s*[\w$.?!]*(kind|provider)\b/i,
];

function todosOsFontes(dir: string, acc: string[] = []): string[] {
  for (const nome of fs.readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (fs.statSync(p).isDirectory()) todosOsFontes(p, acc);
    else if (
      /\.(ts|tsx)$/.test(nome) &&
      !/\.test\./.test(nome) &&
      !/\.d\.ts$/.test(nome)
    )
      acc.push(p);
  }
  return acc;
}

/** Fonte sem comentários: os arquivos EXPLICAM o passado citando a forma
 *  antiga, e checar prosa faria o teste acusar a própria documentação. */
function semComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function violacoes(arquivo: string): string[] {
  const linhas = semComentarios(fs.readFileSync(arquivo, 'utf8')).split('\n');
  const achadas: string[] = [];
  linhas.forEach((linha, i) => {
    if (FORMAS.some((re) => re.test(linha))) {
      achadas.push(`${path.relative(raiz, arquivo)}:${i + 1}: ${linha.trim()}`);
    }
  });
  return achadas;
}

describe('transporte: ninguém compara com o literal fora de transporte.ts', () => {
  it('as formas proibidas são reconhecidas (sanidade do próprio teste)', () => {
    const amostras = [
      "if (channel.kind === 'evolution') {",
      'const x = canal?.provider !== "meta";',
      'provider: row.kind === `evolution` ? `evolution` : `meta`,',
      "if ('meta' === c.kind) {",
      'channelKind !== "evolution" && (',
    ];
    for (const a of amostras) {
      expect(
        FORMAS.some((re) => re.test(a)),
        a
      ).toBe(true);
    }
    // E o que NÃO deve acusar: predicado, filtro de banco, literal em objeto.
    for (const a of [
      'if (ehEvolution(canal)) {',
      ".eq('kind', 'evolution')",
      "provider: 'evolution',",
    ]) {
      expect(
        FORMAS.some((re) => re.test(a)),
        a
      ).toBe(false);
    }
  });

  it('nenhum fonte de src/ compara kind/provider com o literal', () => {
    const achadas = todosOsFontes(raiz)
      .filter((f) => f !== AUTORIZADO)
      .flatMap(violacoes);
    expect(achadas).toEqual([]);
  });

  it('o arquivo autorizado é o que define os predicados', () => {
    const src = fs.readFileSync(AUTORIZADO, 'utf8');
    for (const nome of [
      'ehMeta',
      'ehEvolution',
      'ehInstagram',
      'transporteDe',
    ]) {
      expect(src).toContain(`export function ${nome}(`);
    }
  });
});
