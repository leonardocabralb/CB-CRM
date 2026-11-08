import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { COLUNAS_DO_AGENTE } from '@/lib/ia-agentes/agente';

// ============================================================
// Pinos da 1128 ("Conduz o fechamento", opção por agente de IA). A prova no
// banco mora no bloco DO da própria migration; aqui ficam as peças que uma
// "simplificação" poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1128_cb_ia_agente_conduz_fechamento.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1128 — cb_ia_agentes.conduz_fechamento', () => {
  it('⚠️ boolean NOT NULL DEFAULT false: os agentes que já existem continuam com as regras de sempre', () => {
    expect(codigo).toMatch(
      /ALTER TABLE public\.cb_ia_agentes\s+ADD COLUMN IF NOT EXISTS conduz_fechamento boolean NOT NULL DEFAULT false;/,
    );
    // Nenhuma linha é ligada pela migration: ligar é decisão na tela, por agente.
    expect(codigo).not.toMatch(/UPDATE public\.cb_ia_agentes/i);
  });

  it('nada é concedido ao navegador (a coluna herda os GRANTs de tabela da 1048)', () => {
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
    expect(codigo).toMatch(/has_table_privilege\('anon'/);
  });

  it('o app lê a coluna (é por isso que a migration vai ANTES do deploy)', () => {
    expect(COLUNAS_DO_AGENTE.split(',').map((c) => c.trim())).toContain('conduz_fechamento');
  });
});
