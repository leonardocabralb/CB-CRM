import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { COLUNAS_DO_AGENTE, LIMITES } from '@/lib/ia-agentes/agente';

// ============================================================
// Pinos da 1131 (frases autorizadas por agente de IA). A prova no banco mora
// no bloco DO da própria migration; aqui ficam as peças que uma
// "simplificação" poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1131_cb_ia_agente_frases_autorizadas.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1131 — cb_ia_agentes.frases_autorizadas', () => {
  it("⚠️ text[] NOT NULL DEFAULT '{}': os agentes que já existem continuam com as regras de sempre", () => {
    expect(codigo).toMatch(
      /ALTER TABLE public\.cb_ia_agentes\s+ADD COLUMN IF NOT EXISTS frases_autorizadas text\[\] NOT NULL DEFAULT '\{\}';/,
    );
    // Nenhuma linha é preenchida pela migration: as frases se escrevem na tela, por agente.
    expect(codigo).not.toMatch(/UPDATE public\.cb_ia_agentes/i);
  });

  it('o teto é um CHECK com NOME, e é o MESMO da rota (LIMITES.frasesAutorizadas)', () => {
    const teto = /ADD CONSTRAINT cb_ia_agentes_frases_autorizadas_teto CHECK \(cardinality\(frases_autorizadas\) <= (\d+)\);/.exec(
      codigo,
    );
    expect(teto).not.toBeNull();
    expect(Number(teto?.[1])).toBe(LIMITES.frasesAutorizadas);
    // Reaplicar não deixa dois CHECKs (o DROP é pelo mesmo nome).
    expect(codigo).toMatch(/DROP CONSTRAINT IF EXISTS cb_ia_agentes_frases_autorizadas_teto;/);
  });

  it('a trava espera pouco, e a conferência se desfaz pelo SQLSTATE PRÓPRIO (nunca WHEN OTHERS)', () => {
    expect(codigo).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(codigo).toMatch(/WHEN SQLSTATE 'P1131' THEN NULL;/);
    expect(codigo).not.toMatch(/WHEN OTHERS/i);
  });

  it('nada é concedido ao navegador (a coluna herda os GRANTs de tabela da 1048)', () => {
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
    expect(codigo).toMatch(/has_table_privilege\('anon'/);
  });

  it('o app lê a coluna (é por isso que a migration vai ANTES do deploy)', () => {
    expect(COLUNAS_DO_AGENTE.split(',').map((c) => c.trim())).toContain('frases_autorizadas');
  });
});
