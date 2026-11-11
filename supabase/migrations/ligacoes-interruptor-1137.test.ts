import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { TIPOS_DO_ALARME } from '@/lib/cb-channels/alarmes-no-sino';

// ============================================================
// Pinos da 1137 (o interruptor das ligações pelo CRM e os alarmes do
// computador, 4e). A prova no banco é a conferência da própria migration;
// aqui, o que uma "simplificação" tiraria sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1137_cb_ligacoes_interruptor.sql'), 'utf8');
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

describe('1137 — o interruptor', () => {
  it('⚠️ nasce DESLIGADO: anulável, sem default (o operador liga na tela, D16)', () => {
    const coluna = codigo.match(/ADD COLUMN IF NOT EXISTS ligado_em ([^;]+);/);
    expect(coluna?.[1].trim()).toBe('timestamptz');
  });

  it('trava curta: a tabela é escrita pelo sinal de vida a cada minuto', () => {
    expect(codigo.indexOf("SET LOCAL lock_timeout = '5s'")).toBeLessThan(codigo.indexOf('ALTER TABLE'));
  });
});

describe('1137 — os tipos de alarme', () => {
  it('⚠️ o CHECK do banco e o espelho do código têm EXATAMENTE os mesmos tipos', () => {
    const lista = codigo.match(/CHECK \(tipo IN \(([^)]+)\)\)/)?.[1] ?? '';
    const doBanco = [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(doBanco).toEqual([...TIPOS_DO_ALARME]);
  });

  it('troca o CHECK pelo NOME da 1122 (um velho de pé barraria os tipos novos)', () => {
    expect(codigo).toMatch(/DROP CONSTRAINT IF EXISTS cb_alarmes_de_conexao_tipo_check/);
    expect(codigo).toMatch(/ADD CONSTRAINT cb_alarmes_de_conexao_tipo_check/);
  });

  it('sem função nova e sem abrir as tabelas ao navegador', () => {
    expect(codigo).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(codigo).not.toMatch(/\bGRANT\b/);
    expect(codigo).not.toMatch(/CREATE POLICY/i);
  });
});
