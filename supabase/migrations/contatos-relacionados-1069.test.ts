import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1069 — contatos relacionados: UM vínculo, dois lados.
//
// O que este pino segura:
// - o par repetido é recusado em QUALQUER ordem (índice sobre LEAST/GREATEST):
//   com um índice comum em (a, b), A–B e B–A conviveriam, a aba mostraria a
//   mesma pessoa duas vezes e desvincular deixaria a outra linha de pé;
// - as FKs são COMPOSTAS com a conta e CASCADE: uma FK simples aceitaria a
//   ficha de outra conta, e sem CASCADE apagar contato ficaria bloqueado (ou
//   deixaria vínculo com uma ponta vazia);
// - leitura na forma da 1032 e escrita `agent` (o piso de `contacts_update`);
// - nada para `anon`;
// - a conferência se desfaz só pelo SQLSTATE próprio.
// A conferência DENTRO da 1069 prova o par invertido num banco com fichas;
// este teste roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1069_cb_contatos_relacionados.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

const TABELA = 'cb_contatos_relacionados';

describe('1069 — contatos relacionados', () => {
  it('trava antes de criar e liga a RLS', () => {
    const trava = semComentarios.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(semComentarios.search(/CREATE\s+TABLE/i));
    expect(
      new RegExp(`ALTER\\s+TABLE\\s+public\\.${TABELA}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(semComentarios),
    ).toBe(true);
  });

  it('o par é único nos DOIS sentidos, e a ficha não se liga a si mesma', () => {
    expect(semComentarios).toMatch(
      /CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+public\.cb_contatos_relacionados\s*\(\s*LEAST\(contact_a_id,\s*contact_b_id\),\s*GREATEST\(contact_a_id,\s*contact_b_id\)\s*\)/i,
    );
    expect(semComentarios).toMatch(/CHECK\s*\(\s*contact_a_id\s*<>\s*contact_b_id\s*\)/i);
  });

  it('as duas pontas são FK COMPOSTA com a conta, ON DELETE CASCADE', () => {
    for (const coluna of ['contact_a_id', 'contact_b_id']) {
      expect(semComentarios).toMatch(
        new RegExp(
          `FOREIGN\\s+KEY\\s*\\(\\s*${coluna},\\s*account_id\\s*\\)\\s*REFERENCES\\s+public\\.contacts\\s*\\(\\s*id,\\s*account_id\\s*\\)\\s*ON\\s+DELETE\\s+CASCADE`,
          'i',
        ),
      );
    }
    // Índice em cada ponta: o CASCADE de apagar contato procura pelas duas.
    expect(semComentarios).toMatch(/ON\s+public\.cb_contatos_relacionados\s*\(\s*contact_a_id\s*\)/i);
    expect(semComentarios).toMatch(/ON\s+public\.cb_contatos_relacionados\s*\(\s*contact_b_id\s*\)/i);
  });

  it('quem vinculou é AUTORIA: SET NULL, nunca CASCADE do login', () => {
    expect(semComentarios).toMatch(
      /created_by\s+uuid\s+DEFAULT\s+auth\.uid\(\)\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+SET\s+NULL/i,
    );
  });

  it('leitura na forma da 1032; escrita `agent` por is_account_member', () => {
    const politicas = [
      ...semComentarios.matchAll(new RegExp(`CREATE\\s+POLICY\\s+(\\S+)\\s+ON\\s+public\\.${TABELA}\\s+FOR\\s+(\\w+)([^;]*)`, 'gi')),
    ];
    const porComando = new Map(politicas.map((p) => [p[2].toUpperCase(), p[3]]));
    expect([...porComando.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);

    const leitura = porComando.get('SELECT')!;
    expect(leitura).toMatch(/account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\s*\)\s*\)\s*\)/i);
    expect(leitura).not.toMatch(/is_account_member|\bIN\s*\(\s*SELECT/i);

    for (const cmd of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(porComando.get(cmd)).toMatch(/is_account_member\(account_id,\s*'agent'::account_role_enum\)/i);
    }
  });

  it('nada para anon; o navegador escreve (a RLS decide quem)', () => {
    expect(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+public\\.${TABELA}\\s+FROM\\s+anon`, 'i').test(semComentarios)).toBe(true);
    expect(
      new RegExp(`GRANT\\s+SELECT,\\s*INSERT,\\s*UPDATE,\\s*DELETE\\s+ON\\s+public\\.${TABELA}\\s+TO\\s+authenticated`, 'i').test(semComentarios),
    ).toBe(true);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+public\\.${TABELA}\\b[^;]*\\banon\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it('a prova do par invertido se desfaz só pelo SQLSTATE próprio', () => {
    expect(semComentarios).toMatch(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P1069'/i);
    expect(semComentarios).toMatch(/WHEN\s+SQLSTATE\s+'P1069'/i);
    expect(semComentarios).toMatch(/WHEN\s+unique_violation/i);
    expect(semComentarios).not.toMatch(/WHEN\s+OTHERS/i);
  });
});
