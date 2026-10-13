import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1084 — possível duplicata: a mesma pessoa em duas fichas.
//
// O que este pino segura:
// - a RPC é SECURITY INVOKER: a RLS de `contacts` é a cerca (um DEFINER
//   enxergaria a base de todas as contas);
// - os TRÊS sinais, com os números que a medição de 13/10/2026 escolheu
//   (docs/PLANO-fichas-duplicadas.md): 2 min, lote de 10, e-mail em até 3
//   fichas. Mudar um deles sem medir de novo enche a tela de alarme falso;
// - nome SOZINHO nunca é sinal: o primeiro nome só entra junto com o
//   telefone ou com o horário;
// - o par descartado e o par já ligado em Relacionados saem do aviso;
// - decidir é de ADMIN, com a autoria de quem grava; ler é de qualquer
//   membro, na forma da 1032; a decisão não se edita;
// - nada para `anon`, e quem chama a RPC (INVOKER) chama as auxiliares.
// A conferência DENTRO da 1084 prova as auxiliares com constantes; os
// cenários (lote, e-mail de reserva, 9 a mais, invertidos, outra conta,
// suspenso) foram provados num Postgres 16 descartável — ver o plano.
//
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1084_cb_possiveis_duplicatas.sql'), 'utf8');

const semComentarios = sql
  .split('\n')
  .map((linha) => linha.replace(/--.*$/, ''))
  .join('\n');

const TABELA = 'cb_duplicatas_descartadas';

/** O corpo da RPC, entre os `$$`. */
function corpoDaRpc(): string {
  const inicio = semComentarios.search(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_possiveis_duplicatas\b/i);
  expect(inicio).toBeGreaterThanOrEqual(0);
  const resto = semComentarios.slice(inicio);
  const abre = resto.indexOf('$$');
  const fecha = resto.indexOf('$$', abre + 2);
  return resto.slice(0, fecha);
}

describe('1084 — possível duplicata', () => {
  it('trava antes de criar e liga a RLS da tabela das decisões', () => {
    const trava = semComentarios.search(/SET\s+LOCAL\s+lock_timeout/i);
    expect(trava).toBeGreaterThanOrEqual(0);
    expect(trava).toBeLessThan(semComentarios.search(/CREATE\s+TABLE/i));
    expect(
      new RegExp(`ALTER\\s+TABLE\\s+public\\.${TABELA}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(semComentarios),
    ).toBe(true);
  });

  it('a RPC roda como quem chama (INVOKER), nunca como dona', () => {
    const cabecalho = corpoDaRpc().split('$$')[0];
    expect(cabecalho).toMatch(/SECURITY\s+INVOKER/i);
    expect(cabecalho).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(cabecalho).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it('os três sinais, com os números da medição', () => {
    const corpo = corpoDaRpc();
    // 1) mesmo e-mail, aparado e minúsculo, em até 3 fichas
    expect(corpo).toMatch(/lower\(btrim\(o\.email\)\)\s*=\s*eu\.email/i);
    expect(corpo).toMatch(/lower\(btrim\(x\.email\)\)\s*=\s*eu\.email\)\s*<=\s*3/i);
    // 2) telefone a um dígito de distância, procurado por IGUALDADE no índice
    expect(corpo).toMatch(/o\.telefone_canonico\s*=\s*ANY\s*\(\s*public\.cb_vizinhos_do_telefone\(eu\.tel\)\s*\)/i);
    // 3) até 2 min, fora de lote de mais de 10 fichas (1 min de folga em volta)
    expect(corpo.match(/interval\s+'2 minutes'/gi)?.length).toBe(2);
    expect(corpo.match(/interval\s+'1 minute'/gi)?.length).toBe(2);
    expect(corpo).toMatch(/\+\s*interval\s+'1 minute'\)\s*<=\s*10/i);
  });

  it('nome SOZINHO nunca é sinal: o primeiro nome só vale com o telefone ou o horário', () => {
    const blocos = corpoDaRpc().split(/UNION\s+ALL/i);
    expect(blocos).toHaveLength(3);
    const comNome = blocos.filter((b) => /cb_primeiro_nome\(o\.name\)\s*=\s*eu\.nome/i.test(b));
    expect(comNome).toHaveLength(2);
    expect(comNome[0]).toMatch(/cb_vizinhos_do_telefone/i);
    expect(comNome[1]).toMatch(/o\.created_at\s+BETWEEN/i);
  });

  it('o par descartado e o par já ligado em Relacionados saem do aviso', () => {
    const corpo = corpoDaRpc();
    expect(corpo).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.cb_duplicatas_descartadas/i);
    expect(corpo).toMatch(/NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.cb_contatos_relacionados/i);
    // O par ligado é procurado pela MESMA expressão do índice único da 1069.
    expect(corpo).toMatch(/least\(r\.contact_a_id,\s*r\.contact_b_id\)/i);
    expect(corpo).toMatch(/greatest\(r\.contact_a_id,\s*r\.contact_b_id\)/i);
  });

  it('o par da decisão é ORDENADO, único, e as duas pontas são FK composta com CASCADE', () => {
    expect(semComentarios).toMatch(/CHECK\s*\(\s*contato_menor\s*<\s*contato_maior\s*\)/i);
    expect(semComentarios).toMatch(/UNIQUE\s*\(\s*contato_menor,\s*contato_maior\s*\)/i);
    for (const coluna of ['contato_menor', 'contato_maior']) {
      expect(semComentarios).toMatch(
        new RegExp(
          `FOREIGN\\s+KEY\\s*\\(\\s*${coluna},\\s*account_id\\s*\\)\\s*REFERENCES\\s+public\\.contacts\\s*\\(\\s*id,\\s*account_id\\s*\\)\\s*ON\\s+DELETE\\s+CASCADE`,
          'i',
        ),
      );
    }
    expect(semComentarios).toMatch(/ON\s+public\.cb_duplicatas_descartadas\s*\(\s*contato_maior\s*\)/i);
  });

  it('ler: qualquer membro (1032); decidir e desfazer: admin, com a autoria de quem grava; sem UPDATE', () => {
    const politicas = [
      ...semComentarios.matchAll(new RegExp(`CREATE\\s+POLICY\\s+(\\S+)\\s+ON\\s+public\\.${TABELA}\\s+FOR\\s+(\\w+)([^;]*)`, 'gi')),
    ];
    const porComando = new Map(politicas.map((p) => [p[2].toUpperCase(), p[3]]));
    expect([...porComando.keys()].sort()).toEqual(['DELETE', 'INSERT', 'SELECT']);

    const leitura = porComando.get('SELECT')!;
    expect(leitura).toMatch(/account_id\s*=\s*ANY\s*\(\s*ARRAY\s*\(\s*SELECT\s+public\.cb_contas_do_usuario\(\s*\)\s*\)\s*\)/i);
    expect(leitura).not.toMatch(/is_account_member|\bIN\s*\(\s*SELECT/i);

    const insercao = porComando.get('INSERT')!;
    expect(insercao).toMatch(/is_account_member\(account_id,\s*'admin'::account_role_enum\)/i);
    expect(insercao).toMatch(/descartado_por\s+IS\s+NOT\s+DISTINCT\s+FROM\s+auth\.uid\(\)/i);
    expect(porComando.get('DELETE')!).toMatch(/is_account_member\(account_id,\s*'admin'::account_role_enum\)/i);

    expect(semComentarios).toMatch(new RegExp(`REVOKE\\s+ALL\\s+ON\\s+public\\.${TABELA}\\s+FROM\\s+anon,\\s*authenticated`, 'i'));
    expect(semComentarios).toMatch(
      new RegExp(`GRANT\\s+SELECT,\\s*INSERT,\\s*DELETE\\s+ON\\s+public\\.${TABELA}\\s+TO\\s+authenticated`, 'i'),
    );
  });

  it('nada para anon; quem chama a RPC chama as auxiliares', () => {
    for (const funcao of ['cb_primeiro_nome(text)', 'cb_vizinhos_do_telefone(text)', 'cb_possiveis_duplicatas(uuid)']) {
      const nome = funcao.replace(/[()]/g, (c) => `\\${c}`);
      expect(semComentarios).toMatch(new RegExp(`REVOKE\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+FROM\\s+PUBLIC,\\s*anon`, 'i'));
      expect(semComentarios).toMatch(
        new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${nome}\\s+TO\\s+authenticated,\\s*service_role`, 'i'),
      );
    }
  });

  it('o primeiro nome tira o acento DEPOIS de decompor (NFD), como a régua de etiqueta', () => {
    expect(semComentarios).toMatch(/normalize\(lower\(coalesce\(p_nome,\s*''\)\),\s*NFD\)/i);
    expect(sql).toContain("'[\\u0300-\\u036f]'");
    expect(semComentarios).toMatch(/length\(s\.t\)\s*>=\s*3/i);
  });
});
