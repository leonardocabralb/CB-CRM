import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1043 — agentes de IA. Os pinos que a conferência de dentro da migration não
// cobre (ela confere GRANT, não a forma da policy nem o que a tabela recusa).
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1043_cb_ia_agentes.sql'), 'utf8');
const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

describe('1043 — agentes de IA', () => {
  it('leitura SÓ para administrador (D14), na forma da 1032', () => {
    expect(
      /CREATE\s+POLICY\s+cb_ia_agentes_select\s+ON\s+cb_ia_agentes\s+FOR\s+SELECT\s+USING\s*\(\s*account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\s*\(\s*'admin'::public\.account_role_enum\s*\)\s*\)\s*\)\s*\)/i.test(
        semComentarios,
      ),
    ).toBe(true);
    // Nenhuma escrita ao navegador: só a rota (service role) escreve.
    expect(/CREATE\s+POLICY[^;]*\bON\s+cb_ia_agentes\s+FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(semComentarios)).toBe(false);
    expect(/GRANT\s+(ALL|INSERT|UPDATE|DELETE)[^;]*\bON\s+TABLE\s+cb_ia_agentes\b[^;]*\bauthenticated\b/i.test(semComentarios)).toBe(false);
    expect(/REVOKE\s+ALL\s+ON\s+TABLE\s+cb_ia_agentes\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
  });

  it('nome único entre os NÃO arquivados, sem distinguir maiúsculas', () => {
    expect(
      /CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+cb_ia_agentes\s*\(\s*account_id\s*,\s*lower\s*\(\s*btrim\s*\(\s*nome\s*\)\s*\)\s*\)\s*WHERE\s+arquivado_em\s+IS\s+NULL/i.test(
        semComentarios,
      ),
    ).toBe(true);
  });

  it('autoria e transferência com SET NULL: apagar um login não leva o agente', () => {
    for (const col of ['transferir_para', 'criado_por', 'atualizado_por']) {
      expect(new RegExp(`${col}\\s+uuid\\s+REFERENCES\\s+auth\\.users\\s*\\(\\s*id\\s*\\)\\s+ON\\s+DELETE\\s+SET\\s+NULL`, 'i').test(semComentarios), col).toBe(true);
    }
  });

  it('o CHECK de mode aceita agente e agente_teste (sem ele o uso some calado)', () => {
    expect(/ai_usage_log_mode_check\s+CHECK\s*\([^)]*'agente'[^)]*'agente_teste'/i.test(semComentarios)).toBe(true);
  });

  it('a soma do uso é da service role; a função de gatilho não é RPC', () => {
    expect(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\([^)]*\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\([^)]*\)\s+TO\s+service_role/i.test(semComentarios)).toBe(true);
    expect(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+cb_tira_conexao_dos_agentes_de_ia\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
    expect(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+cb_ia_agente_arquivado_sai_das_passagens\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(semComentarios)).toBe(true);
  });

  it('a soma do uso tem ordem TOTAL (as cinco chaves do grupo): a rota pagina sobre ela', () => {
    const corpo = semComentarios.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_ia_uso[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(/GROUP\s+BY\s+1,\s*2,\s*3,\s*5,\s*6\s+ORDER\s+BY\s+1,\s*2,\s*3,\s*5,\s*6\s*;/i.test(corpo)).toBe(true);
  });

  it('arquivar tira o agente das passagens dos outros NO BANCO, num UPDATE só (array_remove)', () => {
    expect(/AFTER\s+UPDATE\s+OF\s+arquivado_em\s+ON\s+cb_ia_agentes/i.test(semComentarios)).toBe(true);
    const funcao = semComentarios.match(/FUNCTION\s+cb_ia_agente_arquivado_sai_das_passagens[\s\S]*?\$\$;/i)?.[0] ?? '';
    expect(/array_remove\s*\(\s*pode_passar_para\s*,\s*NEW\.id\s*\)/i.test(funcao)).toBe(true);
    expect(/account_id\s*=\s*NEW\.account_id/i.test(funcao)).toBe(true);
  });
});
