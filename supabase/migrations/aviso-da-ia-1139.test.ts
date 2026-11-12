import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { COLUNAS_DO_AGENTE, LIMITES } from '@/lib/ia-agentes/agente';
import { TIPO_DO_AVISO_DA_IA } from '@/lib/notifications/aviso-da-ia';

// ============================================================
// Pinos da 1139 (o aviso quando a IA passa a conversa para a equipe). A prova
// no banco mora no bloco DO da própria migration; aqui ficam as peças que uma
// "simplificação" poderia tirar sem nenhum teste de tela acusar.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1139_cb_aviso_da_ia_que_passa.sql'), 'utf8');

// Só o código, sem os comentários (que citam as mesmas palavras).
const codigo = sql
  .split('\n')
  .filter((linha) => !linha.trim().startsWith('--'))
  .join('\n');

/** Os tipos do CHECK, na ordem escrita. */
function tiposDoCheck(fonte: string): string[] {
  const m = /ADD CONSTRAINT notifications_type_check\s+CHECK \(type IN \(([\s\S]*?)\)\);/.exec(fonte);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

describe('1139 — notifications.type ganha ia_transferiu', () => {
  it('o CHECK reescrito mantém os seis tipos de antes e acrescenta o da IA', () => {
    const tipos = tiposDoCheck(codigo);
    expect(tipos).toEqual([
      'conversation_assigned',
      'note_mention',
      'note_reply',
      'task_assigned',
      'task_reply',
      'whatsapp_alert',
      'ia_transferiu',
    ]);
  });

  it('o tipo é o que o app grava (a paridade com o tipo TS mudou para o pino da 1140, a mais nova)', () => {
    expect(tiposDoCheck(codigo)).toContain(TIPO_DO_AVISO_DA_IA);
  });

  it('a conferência cobra que nenhum tipo antigo se perdeu', () => {
    for (const antigo of ['conversation_assigned', 'note_mention', 'note_reply', 'task_assigned', 'task_reply', 'whatsapp_alert']) {
      expect(codigo).toContain(`NOT LIKE '%${antigo}%'`);
    }
  });
});

describe('1139 — cb_ia_agentes.avisar_ao_transferir', () => {
  it("⚠️ uuid[] NOT NULL DEFAULT '{}': os agentes que já existem avisam o dono, os admins e quem atende o número", () => {
    expect(codigo).toMatch(
      /ALTER TABLE public\.cb_ia_agentes\s+ADD COLUMN IF NOT EXISTS avisar_ao_transferir uuid\[\] NOT NULL DEFAULT '\{\}';/,
    );
    // Nenhuma linha é preenchida pela migration: a lista se escolhe na tela, por agente.
    expect(codigo).not.toMatch(/UPDATE public\.cb_ia_agentes/i);
  });

  it('o teto é um CHECK com NOME, e é o MESMO da rota (LIMITES.avisarAoTransferir)', () => {
    const teto = /ADD CONSTRAINT cb_ia_agentes_avisar_ao_transferir_teto CHECK \(cardinality\(avisar_ao_transferir\) <= (\d+)\);/.exec(
      codigo,
    );
    expect(teto).not.toBeNull();
    expect(Number(teto?.[1])).toBe(LIMITES.avisarAoTransferir);
    expect(codigo).toMatch(/DROP CONSTRAINT IF EXISTS cb_ia_agentes_avisar_ao_transferir_teto;/);
  });

  it('a trava espera pouco, e a conferência se desfaz pelo SQLSTATE PRÓPRIO (nunca WHEN OTHERS)', () => {
    expect(codigo).toMatch(/SET LOCAL lock_timeout = '5s';/);
    expect(codigo).toMatch(/WHEN SQLSTATE 'P1139' THEN NULL;/);
    expect(codigo).not.toMatch(/WHEN OTHERS/i);
  });

  it('nada é concedido ao navegador (a coluna herda os GRANTs de tabela da 1048)', () => {
    expect(codigo).not.toMatch(/GRANT[^;]*\b(anon|authenticated)\b/i);
    expect(codigo).toMatch(/has_table_privilege\('anon'/);
  });

  it('o app lê a coluna (é por isso que a migration vai ANTES do deploy)', () => {
    expect(COLUNAS_DO_AGENTE.split(',').map((c) => c.trim())).toContain('avisar_ao_transferir');
  });
});
