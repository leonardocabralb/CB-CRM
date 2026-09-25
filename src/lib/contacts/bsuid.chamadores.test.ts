import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// Quem ESCREVE a identidade BSUID da ficha — default-deny, no desenho de
// `chave-canonica.chamadores.test.ts` (Fase 11.2).
//
// `wa_user_id` é a chave única da ficha por conta (1038): um valor errado
// gravado ali casa, para sempre, as mensagens só-BSUID de uma pessoa com a
// ficha de OUTRA — e o preenchimento só escreve em branco, então nada o
// corrige. `wa_username` e `wa_parent_user_id` vêm na mesma entrega e seguem a
// mesma régua. Hoje o ÚNICO escritor é a entrada da Meta, com as cercas no
// WHERE (`.is('wa_user_id', null)` no preenchimento, `.eq('wa_user_id', …)` no
// `@` e no pai). CSV, API v1, Evolution e telas NÃO gravam essas colunas.
//
// Como funciona: toda CHAVE de objeto com um desses nomes (`wa_user_id:`,
// também entre aspas) em `src/` — sem comentários, sem testes — entra na
// contagem por arquivo e por coluna, e o conjunto é EXATO. Escritor novo
// reprova aqui até alguém declarar, por escrito, por que ele pode gravar a
// identidade do WhatsApp. Leitura (`.eq('wa_user_id', …)`, `select('…
// wa_username')`, `contact.wa_username`) e tipo opcional (`wa_user_id?:`) não
// contam.
// ============================================================

const SRC = path.join(__dirname, '..', '..');

const COLUNAS = ['wa_user_id', 'wa_parent_user_id', 'wa_username'] as const;
type Coluna = (typeof COLUNAS)[number];

/** arquivo → quantas chaves de objeto de cada coluna ele escreve. */
const ESCRITORES: Record<string, Partial<Record<Coluna, number>>> = {
  // O INSERT da ficha nova (as três), o preenchimento do BSUID na ficha
  // achada pelo telefone (as três) e a atualização do `@` e do pai na ficha
  // achada pelo BSUID (as duas).
  'app/api/whatsapp/webhook/route.ts': { wa_user_id: 2, wa_parent_user_id: 3, wa_username: 3 },
};

function* todosOsFontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* todosOsFontes(p);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) yield p;
  }
}

function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function contar(): Record<string, Partial<Record<Coluna, number>>> {
  const achado: Record<string, Partial<Record<Coluna, number>>> = {};
  for (const abs of todosOsFontes(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/');
    const src = semComentarios(fs.readFileSync(abs, 'utf8'));
    for (const coluna of COLUNAS) {
      // Chave de objeto: o nome (entre aspas ou não) seguido de `:`. A borda
      // da esquerda impede `wa_user_id` de contar dentro de outro nome.
      const re = new RegExp(`(?<![\\w])['"]?${coluna}['"]?\\s*:`, 'g');
      const n = [...src.matchAll(re)].length;
      if (n) (achado[rel] ??= {})[coluna] = n;
    }
  }
  return achado;
}

describe('BSUID: só a entrada da Meta escreve a identidade do WhatsApp na ficha', () => {
  const achado = contar();

  it('o conjunto de escritores das três colunas é EXATO', () => {
    expect(achado).toEqual(ESCRITORES);
  });

  it('o scanner enxerga chave entre aspas e ignora tipo opcional e leitura', () => {
    const re = (c: string) => new RegExp(`(?<![\\w])['"]?${c}['"]?\\s*:`, 'g');
    expect([...`{ 'wa_user_id': x }`.matchAll(re('wa_user_id'))]).toHaveLength(1);
    expect([...`wa_user_id?: string | null`.matchAll(re('wa_user_id'))]).toHaveLength(0);
    expect([...`.eq('wa_user_id', x)`.matchAll(re('wa_user_id'))]).toHaveLength(0);
    expect([...`{ wa_parent_user_id: x }`.matchAll(re('wa_user_id'))]).toHaveLength(0);
  });

  it('o preenchimento do BSUID e a troca do @ levam a cerca no WHERE', () => {
    const src = semComentarios(
      fs.readFileSync(path.join(SRC, 'app/api/whatsapp/webhook/route.ts'), 'utf8'),
    );
    // Cada UPDATE em `contacts` que escreve uma das colunas, até a próxima
    // consulta.
    const cadeias = [...src.matchAll(/\.from\(\s*['"]contacts['"]\s*\)\s*\.\s*update\s*\(/g)]
      .map((m) => {
        const inicio = m.index ?? 0;
        const fim = src.indexOf('.from(', inicio + 5);
        return src.slice(inicio, fim === -1 ? undefined : fim);
      })
      .filter((c) => /(?<![\w])wa_(?:user_id|parent_user_id|username)\s*:/.test(c));
    expect(cadeias).toHaveLength(2);
    // O que grava o BSUID só escreve em branco; o que não o grava só alcança a
    // ficha que ainda é deste BSUID.
    for (const c of cadeias) {
      if (/(?<![\w])wa_user_id\s*:/.test(c)) {
        expect(c).toMatch(/\.is\(\s*['"]wa_user_id['"]\s*,\s*null\s*\)/);
      } else {
        expect(c).toMatch(/\.eq\(\s*['"]wa_user_id['"]\s*,/);
      }
    }
  });
});
