import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1046 — o celular de cada membro mora numa tabela FECHADA: a pessoa lê o
// próprio, os administradores da conta dela leem o da equipe, e só a rota
// (service role) grava, depois de conferir o número.
//
// O que este pino segura:
// - um GRANT de escrita a `authenticated` dado por engano deixaria o
//   navegador gravar QUALQUER texto no celular (a régua mora na rota) e
//   apagar o próprio — que devolve a pessoa à tela de exigência;
// - uma policy de leitura sem o recorte de administrador mostraria o celular
//   de cada pessoa a todos os colegas, que é exatamente o que tirou o número
//   de `profiles`;
// - a forma da 1032 (a conta perguntada uma vez por consulta).
// A conferência DENTRO da 1046 prova a leitura trocando de papel; este teste
// roda no job `verificar`, que é portão.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1046_cb_celular_dos_membros.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

const TABELA = 'cb_celulares_dos_membros';

describe('1046 — o celular dos membros', () => {
  it('liga a RLS e trava antes de criar', () => {
    expect(new RegExp(`ALTER\\s+TABLE\\s+${TABELA}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(semComentarios)).toBe(true);
    const trava = semComentarios.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(semComentarios.search(/CREATE\s+TABLE/i));
  });

  it('a chave é o LOGIN, com CASCADE, e o CHECK é o piso de forma', () => {
    expect(/user_id\s+uuid\s+PRIMARY\s+KEY\s+REFERENCES\s+auth\.users\s*\(\s*id\s*\)\s+ON\s+DELETE\s+CASCADE/i.test(semComentarios)).toBe(true);
    expect(semComentarios).toContain("CHECK (celular ~ '^[1-9][0-9]{7,14}$')");
  });

  it('tira tudo de PUBLIC, anon e authenticated, e dá por escrito: SELECT ao navegador, ALL ao servidor', () => {
    expect(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${TABELA}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated`, 'i').test(semComentarios)).toBe(true);
    expect(new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+${TABELA}\\s+TO\\s+authenticated`, 'i').test(semComentarios)).toBe(true);
    expect(new RegExp(`GRANT\\s+ALL\\s+ON\\s+TABLE\\s+${TABELA}\\s+TO\\s+service_role`, 'i').test(semComentarios)).toBe(true);
  });

  it('o navegador NÃO escreve: nenhum grant de escrita a authenticated e nenhuma policy de escrita', () => {
    expect(new RegExp(`GRANT\\s+(ALL|INSERT|UPDATE|DELETE)[^;]*\\bON\\s+TABLE\\s+${TABELA}\\b[^;]*\\bauthenticated\\b`, 'i').test(semComentarios)).toBe(false);
    expect(new RegExp(`GRANT[^;]*\\bON\\s+TABLE\\s+${TABELA}\\b[^;]*\\banon\\b`, 'i').test(semComentarios)).toBe(false);
    expect(new RegExp(`CREATE\\s+POLICY[^;]*\\bON\\s+${TABELA}\\s+FOR\\s+(INSERT|UPDATE|DELETE|ALL)\\b`, 'i').test(semComentarios)).toBe(false);
  });

  it('UMA policy de leitura: a própria pessoa OU administrador da conta dela, na forma da 1032', () => {
    const politicas = [...semComentarios.matchAll(new RegExp(`CREATE\\s+POLICY\\s+\\S+\\s+ON\\s+${TABELA}\\b([^;]*)`, 'gi'))];
    expect(politicas).toHaveLength(1);
    const corpo = politicas[0][1];
    expect(corpo).toMatch(/FOR\s+SELECT/i);
    expect(corpo).toMatch(/user_id\s*=\s*\(\s*SELECT\s+auth\.uid\(\)\s*\)/i);
    expect(corpo).toMatch(
      /p\.account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\s*'admin'::public\.account_role_enum\s*\)\s*\)\s*\)/i,
    );
    // A pergunta por linha que a 1032 aposentou.
    expect(corpo).not.toMatch(/is_account_member|\bIN\s*\(\s*SELECT\s+(?:public\.)?cb_contas_do_usuario/i);
  });

  it('concede o SELECT em profiles que a policy usa (banco vazio não herda do Supabase)', () => {
    expect(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.profiles\s+TO\s+authenticated/i.test(semComentarios)).toBe(true);
  });

  it('a conferência prova a leitura trocando de papel e se desfaz só pelo SQLSTATE próprio', () => {
    expect(semComentarios).toMatch(/SET\s+LOCAL\s+ROLE\s+authenticated/i);
    expect(semComentarios).toMatch(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P1046'/i);
    expect(semComentarios).toMatch(/WHEN\s+SQLSTATE\s+'P1046'/i);
    expect(semComentarios).not.toMatch(/WHEN\s+OTHERS/i);
  });
});
