import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { CLASSES } from '@/lib/funil/degraus';

// ============================================================
// As classes de degrau que o BANCO aceita (o CHECK de
// `pipeline_stages.degrau`) batem com as que o CÓDIGO conhece?
//
// ⚠️ Por que importa: o `PipelineSettings` grava o degrau de todas as etapas
// num upsert só. Classe nova no código (a `pasta`, 1054) sem a migration que
// a acrescenta ao CHECK faz o salvamento de "Gerenciar funil" ser recusado
// inteiro — e classe que o banco aceita sem o código conhecer é lida como
// "não conta" (`classificarEtapas`), sumindo em silêncio do Desempenho.
//
// O CHECK vigente é o da ÚLTIMA migration que recria
// `cb_pipeline_stages_degrau_check` (lida pelo nome do arquivo).
// ============================================================

const PASTA = path.resolve(__dirname);

/** A migration da pasta, achada pelo NOME (renumerar antes de aplicar não quebra o teste). */
function arquivoDaPasta(): string {
  const achados = fs
    .readdirSync(PASTA)
    .filter((f) => /^\d{4}_cb_degrau_pasta_e_painel_do_funil\.sql$/.test(f));
  expect(achados).toHaveLength(1);
  return achados[0];
}

function checkVigente(): { arquivo: string; classes: string[] } {
  const arquivos = fs
    .readdirSync(PASTA)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  let achado: { arquivo: string; classes: string[] } | null = null;
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(PASTA, arquivo), 'utf8');
    const m = sql.match(
      /ADD\s+CONSTRAINT\s+cb_pipeline_stages_degrau_check\s+CHECK\s*\(\s*degrau\s+IS\s+NULL\s+OR\s+degrau\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
    );
    if (m) achado = { arquivo, classes: [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
  }
  if (!achado) throw new Error('nenhuma migration recria cb_pipeline_stages_degrau_check');
  return achado;
}

describe('degraus do funil: banco × código', () => {
  it('o CHECK vigente é o da migration da pasta (ou de uma posterior)', () => {
    expect(checkVigente().arquivo >= arquivoDaPasta()).toBe(true);
  });

  it('o CHECK aceita exatamente as classes do código (pasta inclusive)', () => {
    const { classes } = checkVigente();
    expect(new Set(classes).size).toBe(classes.length);
    expect([...classes].sort()).toEqual([...CLASSES].sort());
    expect(classes).toContain('pasta');
  });

  it('a conferência cobra as mesmas classes que o CHECK grava', () => {
    const sql = fs.readFileSync(path.join(PASTA, arquivoDaPasta()), 'utf8');
    const lista = sql.match(/v_classes\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\];/);
    expect(lista).not.toBeNull();
    const conferidas = [...lista![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(conferidas).toEqual([...checkVigente().classes].sort());
  });

  it('leva lock_timeout, derruba o CHECK velho pela FORMA e se desfaz por SQLSTATE próprio', () => {
    const sql = fs.readFileSync(path.join(PASTA, arquivoDaPasta()), 'utf8');
    expect(sql).toMatch(/SET LOCAL lock_timeout/);
    expect(sql).toMatch(/degrau = ANY \\\(ARRAY\\\[/);
    expect(sql).toMatch(/WHEN SQLSTATE 'P1054' THEN NULL/);
    expect(sql).not.toMatch(/WHEN OTHERS/);
  });

  it('o painel do funil é jsonb NOT NULL com o objeto vazio de padrão (o parse lê {} como o padrão)', () => {
    const sql = fs.readFileSync(path.join(PASTA, arquivoDaPasta()), 'utf8');
    expect(sql).toMatch(
      /ALTER TABLE public\.pipelines\s+ADD COLUMN IF NOT EXISTS painel jsonb NOT NULL DEFAULT '\{\}'::jsonb;/,
    );
  });
});
