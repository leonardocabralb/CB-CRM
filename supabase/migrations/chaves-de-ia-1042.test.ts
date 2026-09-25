import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1042 — a chave de IA é do PROVEDOR, uma por conta (`cb_ia_chaves`), e a
// tabela é FECHADA ao navegador: a chave cifrada não passa pelo PostgREST
// com a sessão de ninguém. A conferência DENTRO da migration testa GRANT
// (não RLS); este teste roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1042_cb_ia_chaves_por_provedor.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('1042 — chaves de IA por provedor', () => {
  it('RLS ligada, NENHUMA policy e nada para anon/authenticated', () => {
    expect(/ALTER\s+TABLE\s+cb_ia_chaves\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(semComentarios)).toBe(true);
    expect(
      /REVOKE\s+ALL\s+ON\s+TABLE\s+cb_ia_chaves\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios),
    ).toBe(true);
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_ia_chaves\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT[^;]*\bON\s+TABLE\s+cb_ia_chaves\b[^;]*\b(anon|authenticated)\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT\s+ALL\s+ON\s+TABLE\s+cb_ia_chaves\s+TO\s+service_role/i.test(semComentarios)).toBe(true);
  });

  it('UMA chave por (conta, provedor), num UNIQUE TOTAL — é o alvo do upsert da rota', () => {
    expect(/UNIQUE\s*\(\s*account_id\s*,\s*provedor\s*\)/i.test(semComentarios)).toBe(true);
    expect(/CHECK\s*\(\s*provedor\s+IN\s*\(\s*'openai'\s*,\s*'anthropic'\s*,\s*'gemini'\s*\)\s*\)/i.test(semComentarios)).toBe(true);
  });

  it('autoria com SET NULL: apagar o login de quem cadastrou não leva a chave do Radar', () => {
    expect(/atualizada_por\s+uuid\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i.test(semComentarios)).toBe(true);
  });

  it('copia as chaves de hoje sem sobrescrever (reexecução) e a de embeddings só no slot vazio da OpenAI', () => {
    const insercoes = semComentarios.match(/INSERT\s+INTO\s+cb_ia_chaves[\s\S]*?;/gi) ?? [];
    expect(insercoes).toHaveLength(2);
    for (const i of insercoes) {
      expect(/ON\s+CONFLICT\s*\(\s*account_id\s*,\s*provedor\s*\)\s+DO\s+NOTHING/i.test(i)).toBe(true);
    }
    expect(/embeddings_api_key/i.test(insercoes[1])).toBe(true);
    expect(/'openai'/.test(insercoes[1])).toBe(true);
  });

  it('ai_configs.api_key perde o NOT NULL (a linha padrão existe sem chave)', () => {
    expect(/ALTER\s+TABLE\s+ai_configs\s+ALTER\s+COLUMN\s+api_key\s+DROP\s+NOT\s+NULL/i.test(semComentarios)).toBe(true);
  });
});
