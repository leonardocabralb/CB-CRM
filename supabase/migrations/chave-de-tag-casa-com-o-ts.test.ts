import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { chaveDeTag } from '@/lib/contacts/chave-de-tag';

// ============================================================
// A régua de "mesma etiqueta" existe DUAS vezes: em TS (`chaveDeTag`) e em
// SQL (a coluna gerada `tags.name_key`). Elas precisam concordar — a
// divergência entre as duas foi o defeito que a 983 fechou, e o furo que a
// 984 fechou depois.
//
// Um teste não roda SQL, então o que dá para cobrar aqui é a FORMA da
// expressão. A equivalência de VALOR foi medida contra o Postgres de
// produção em 2026-09-09 (precomposta e decomposta → "bancario"; "Bancária"
// segue distinta; `a^b` e `ø` sobrevivem) e está escrita no cabeçalho da
// migration.
// ============================================================

const p = (arquivo: string) =>
  readFileSync(path.join(__dirname, arquivo), 'utf8');

const SQL_984 = p('984_cb_chave_de_tag_normalizada.sql');

const semComentarios = (sql: string) =>
  sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');

describe('984 — a régua do SQL casa com a do TS', () => {
  const corpo = semComentarios(SQL_984);

  it('CRÍTICO: a coluna gerada NORMALIZA antes de apagar os sinais', () => {
    // Sem o `normalize(..., NFD)`, a forma decomposta de um nome acentuado
    // gera outra chave e o índice único deixa a duplicata entrar — que é
    // exatamente o furo que a 983 tinha.
    expect(/normalize\(\s*lower\(\s*btrim\(\s*name/i.test(corpo)).toBe(true);
    expect(/normalize\([^)]*NFD\s*\)/i.test(corpo)).toBe(true);
  });

  it('CRÍTICO: apaga o bloco de sinais combinantes U+0300–U+036F', () => {
    expect(/regexp_replace\(/i.test(corpo)).toBe(true);
    expect(corpo).toContain('u0300-\\u036f');
  });

  it('⚠️ o intervalo é escrito por ESCAPE, nunca com o caractere literal', () => {
    // Caractere combinante literal num arquivo é invisível para quem lê ou
    // edita — e some numa cópia descuidada. Já aconteceu ao escrever esta
    // própria migration.
    const combinanteLiteral = /[̀-ͯ]/u;
    expect(combinanteLiteral.test(SQL_984)).toBe(false);
  });

  it('a coluna é RECRIADA, e o índice volta depois', () => {
    // `ALTER ... SET EXPRESSION` só existe no PG 17, e a migration precisa
    // replayar no Postgres que o CI subir.
    expect(/DROP COLUMN IF EXISTS name_key/i.test(corpo)).toBe(true);
    expect(/ADD COLUMN name_key[\s\S]*GENERATED ALWAYS AS/i.test(corpo)).toBe(true);
    expect(/CREATE UNIQUE INDEX[\s\S]*tags_conta_nome_uk/i.test(corpo)).toBe(true);
  });

  it('a migration RENOMEIA a duplicata, nunca apaga', () => {
    // Apagar quebraria em silêncio as regras que referenciam `tags.id` por
    // JSON — automação, fluxo e o recorte salvo da caixa de entrada —, que
    // nenhuma FK protege.
    expect(/UPDATE\s+tags[\s\S]*?SET\s+name\s*=/i.test(corpo)).toBe(true);
    expect(/DELETE\s+FROM\s+tags/i.test(corpo)).toBe(false);
  });

  it('o TS trata as duas formas Unicode como a mesma etiqueta', () => {
    // O outro lado da equivalência que a migration garante no banco.
    const pre = 'Bancário';
    expect(chaveDeTag(pre.normalize('NFD'))).toBe(chaveDeTag(pre));
    expect(chaveDeTag(pre.normalize('NFC'))).toBe('bancario');
  });

  it('os nomes reais do escritório continuam distintos entre si', () => {
    const reais = [
      'Ag. Demissão', 'Bancário', 'Cliente Fechado', 'Demitida',
      'Desqualificado', 'Formulário', 'Imobiliario', 'Pediu Demissão',
      'Setor Acordo', 'Trabalhista', 'Typebot',
    ];
    expect(new Set(reais.map(chaveDeTag)).size).toBe(reais.length);
  });
});
