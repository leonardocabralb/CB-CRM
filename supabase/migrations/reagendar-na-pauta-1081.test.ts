import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { RESULTADOS } from '@/lib/reunioes/pauta';

// ============================================================
// 1081 — "Reagendar" na pauta de reuniões. O que este pino segura:
//
// 1. A marca 'reagendar' entra no CHECK da etapa SEM tirar as três de antes
//    (a 1058 e a 1063): um CHECK reescrito sem elas faria o Gerenciar funil
//    recusar as marcas já gravadas.
// 2. O CHECK de forma do marco aceita EXATAMENTE os resultados do código
//    (`RESULTADOS`): resultado novo no código sem migration faz o botão ser
//    recusado pelo banco; e continua exigindo `resultado IS NOT NULL` (`NULL
//    IN (…)` dá NULL, e CHECK que avalia NULL PASSA) e valor só na proposta.
// 3. `cb_reunioes_marcos.inicio` é timestamptz NULÁVEL e sem default: os
//    marcos antigos não o têm, e um `now()` de padrão afirmaria um horário
//    de reunião que ninguém viu.
// 4. Idempotente (DROP IF EXISTS do MESMO nome antes de cada ADD — nome que
//    não casa deixa o CHECK velho de pé), `lock_timeout` antes da primeira
//    ALTER, e a conferência se desfaz pelo SQLSTATE próprio.
// ============================================================

const PASTA = path.resolve(__dirname);

/** Os arquivos de migration, na ordem do replay (por nome). */
const MIGRATIONS = fs
  .readdirSync(PASTA)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

/** Sem os comentários: um comentário que descreva a forma certa não pode fazer o pino passar. */
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const ler = (arquivo: string) => semComentarios(fs.readFileSync(path.join(PASTA, arquivo), 'utf8'));

/** A migration do Reagendar, achada pelo NOME (renumerar antes de aplicar não quebra o pino). */
const ARQUIVO = (() => {
  const achados = MIGRATIONS.filter((f) => /^\d{4}_cb_reagendar_na_pauta\.sql$/.test(f));
  if (achados.length !== 1) throw new Error(`esperada UMA migration *_cb_reagendar_na_pauta.sql (achadas: ${achados.length})`);
  return achados[0];
})();
const CODIGO = ler(ARQUIVO);

/** O corpo do CHECK `nome` (o que vai entre os parênteses), pelos parênteses casados. */
function corpoDoCheck(codigo: string, nome: string): string | null {
  const m = new RegExp(`CONSTRAINT\\s+${nome}\\s+CHECK\\s*\\(`).exec(codigo);
  if (!m) return null;
  const inicio = m.index + m[0].length;
  let nivel = 1;
  for (let i = inicio; i < codigo.length; i++) {
    if (codigo[i] === '(') nivel++;
    if (codigo[i] === ')' && --nivel === 0) return codigo.slice(inicio, i);
  }
  return null;
}

/** O CHECK vigente: o da ÚLTIMA migration (na ordem do replay) que o cria. */
function checkVigente(nome: string): { arquivo: string; corpo: string } {
  let achado: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of MIGRATIONS) {
    const corpo = corpoDoCheck(ler(arquivo), nome);
    if (corpo !== null) achado = { arquivo, corpo };
  }
  if (!achado) throw new Error(`nenhuma migration cria ${nome}`);
  return achado;
}

/** Os valores da lista `<coluna> IN ('a', 'b', …)` de um CHECK. */
function valoresDoIn(corpo: string, coluna: string): string[] {
  const m = new RegExp(`${coluna}\\s+IN\\s*\\(([^)]*)\\)`).exec(corpo);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('1081 — Reagendar na pauta', () => {
  it('o CHECK da etapa aceita as QUATRO marcas — as três de antes continuam', () => {
    const corpo = corpoDoCheck(CODIGO, 'cb_pipeline_stages_desfecho_da_reuniao_check');
    expect(corpo).not.toBeNull();
    expect(corpo).toMatch(/^desfecho_da_reuniao IS NULL OR desfecho_da_reuniao IN \(/);
    expect(valoresDoIn(corpo!, 'desfecho_da_reuniao')).toEqual(['qualificada', 'compareceu', 'faltou', 'reagendar']);
  });

  it('o CHECK VIGENTE da etapa (o da última migration que o recria) mantém as quatro marcas', () => {
    const { arquivo, corpo } = checkVigente('cb_pipeline_stages_desfecho_da_reuniao_check');
    expect(arquivo >= ARQUIVO).toBe(true);
    expect(valoresDoIn(corpo, 'desfecho_da_reuniao')).toEqual(
      expect.arrayContaining(['qualificada', 'compareceu', 'faltou', 'reagendar']),
    );
  });

  it('o CHECK de forma do marco aceita os quatro resultados, e mantém o resto da forma da 1063', () => {
    const corpo = corpoDoCheck(CODIGO, 'cb_reunioes_marcos_forma_ck');
    expect(corpo).not.toBeNull();
    expect([...valoresDoIn(corpo!, 'resultado')].sort()).toEqual(['no_show', 'proposta', 'reagendar', 'sem_proposta']);
    expect(corpo).toMatch(/\(marco = 'qualificada' AND resultado IS NULL AND valor IS NULL\)/);
    expect(corpo).toMatch(/marco = 'resultado' AND resultado IS NOT NULL/);
    expect(corpo).toMatch(/\(resultado = 'proposta' OR valor IS NULL\)/);
    expect(corpo).toMatch(/\(valor IS NULL OR valor >= 0\)/);
  });

  it('o CHECK VIGENTE do marco aceita exatamente os resultados do código (RESULTADOS)', () => {
    const { arquivo, corpo } = checkVigente('cb_reunioes_marcos_forma_ck');
    expect(arquivo >= ARQUIVO).toBe(true);
    expect([...valoresDoIn(corpo, 'resultado')].sort()).toEqual([...RESULTADOS].sort());
  });

  it('a coluna inicio é timestamptz NULÁVEL e sem default', () => {
    expect(CODIGO).toMatch(/ALTER TABLE public\.cb_reunioes_marcos\s+ADD COLUMN IF NOT EXISTS inicio timestamptz;/);
    expect(CODIGO).not.toMatch(/inicio\s+timestamptz[^;]*NOT NULL/i);
    expect(CODIGO).not.toMatch(/inicio\s+timestamptz[^;]*DEFAULT/i);
    expect(CODIGO).not.toMatch(/ALTER COLUMN inicio/i);
  });

  it('DROP CONSTRAINT IF EXISTS do MESMO nome, na mesma tabela, antes de cada ADD — e o nome é o que as migrations anteriores criaram', () => {
    for (const [tabela, nome] of [
      ['pipeline_stages', 'cb_pipeline_stages_desfecho_da_reuniao_check'],
      ['cb_reunioes_marcos', 'cb_reunioes_marcos_forma_ck'],
    ] as const) {
      const drop = new RegExp(`ALTER TABLE public\\.${tabela}\\s+DROP CONSTRAINT IF EXISTS ${nome};`).exec(CODIGO);
      const add = new RegExp(`ALTER TABLE public\\.${tabela}\\s+ADD CONSTRAINT ${nome}\\s`).exec(CODIGO);
      expect(drop, `DROP de ${nome}`).not.toBeNull();
      expect(add, `ADD de ${nome}`).not.toBeNull();
      expect(drop!.index).toBeLessThan(add!.index);
      // O DROP só derruba o velho se o nome casar com o que já existe.
      const anteriores = MIGRATIONS.filter((f) => f < ARQUIVO).filter((f) => corpoDoCheck(ler(f), nome) !== null);
      expect(anteriores.length, `migration anterior que cria ${nome}`).toBeGreaterThan(0);
    }
  });

  it('lock_timeout antes da primeira ALTER', () => {
    const lock = CODIGO.search(/SET LOCAL lock_timeout/);
    const alter = CODIGO.search(/ALTER TABLE/);
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(alter);
  });

  it('a conferência prova as quatro marcas e o reagendar sem valor, e se desfaz com o SQLSTATE próprio', () => {
    const conferidas = /unnest\(ARRAY\[([^\]]*)\]\)/.exec(CODIGO);
    expect(conferidas).not.toBeNull();
    expect([...conferidas![1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual([
      'qualificada',
      'compareceu',
      'faltou',
      'reagendar',
    ]);
    expect(CODIGO).toMatch(/'resultado', 'reagendar', now\(\)\)/);
    expect(CODIGO).toMatch(/'resultado', 'reagendar', 10\)/);
    expect(CODIGO).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P1081'/);
    expect(CODIGO).toMatch(/WHEN SQLSTATE 'P1081' THEN NULL;/);
    expect(CODIGO).not.toMatch(/WHEN OTHERS/);
  });
});
