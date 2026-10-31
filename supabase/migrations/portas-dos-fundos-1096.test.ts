import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1096 — conversa e mensagem não se apagam pelo navegador.
//
// A 0017 (do upstream) dava a qualquer `agent` o DELETE de `conversations`
// (`conversations_delete`) e de `messages` (`messages_modify`, FOR ALL): uma
// conversa inteira, com as mensagens, apagada pelo PostgREST, contornando a
// régua "excluir contato é só de admin" (981). A 1096 tirou as duas policies
// e o privilégio. Conversa e mensagem passam a sair só pela ficha (CASCADE,
// que roda como o dono da tabela), pelas funções SECURITY DEFINER e pelo
// service role.
//
// O caminho provável da regressão é um merge do upstream: as policies são
// dele e voltam SEM conflito (docs/MERGE-UPSTREAM.md, §6). Este pino lê as
// migrations POSTERIORES à 1096 e reprova quem devolver o apagar.
//
// LIMITE DECLARADO: lê os `.sql`. Policy ou GRANT feitos por `EXECUTE`
// dentro de um bloco DO ficam invisíveis — é por isso que o
// `supabase/ci/verify-schema.sql` confere o CATÁLOGO no FIM do replay (a
// conferência da própria 1096 só vale no instante dela). As duas metades
// juntas, como a 964 (`policies-de-escrita.test.ts`).
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1096_cb_atendente_nao_apaga_conversa.sql';
const SQL_1096 = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
const VERIFY = fs.readFileSync(path.join(DIR, '..', 'ci', 'verify-schema.sql'), 'utf8');

/** Com ou sem aspas: `public.messages`, `"public"."messages"`, `messages`. */
const TABELAS = '(?:"?public"?\\.)?"?(?:conversations|messages)"?';

/** Migrations numeradas DEPOIS da 1096, em ordem de nome (a do replay). */
function posteriores(): Array<{ nome: string; sql: string }> {
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && f > ARQUIVO)
    .sort()
    .map((nome) => ({ nome, sql: fs.readFileSync(path.join(DIR, nome), 'utf8') }));
}

/** Tira comentários de linha: a explicação pode citar o SQL proibido. */
function semComentarios(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

/**
 * Policy de DELETE ou FOR ALL (CREATE POLICY sem `FOR` também é ALL) nas
 * duas tabelas — o corpo vai até o `;`.
 */
function policiesQueApagam(sql: string): string[] {
  const achadas: string[] = [];
  const cria = new RegExp(`CREATE\\s+POLICY\\s+("[^"]+"|\\w+)\\s+ON\\s+${TABELAS}(?![\\w])([^;]*)`, 'gi');
  for (const m of semComentarios(sql).matchAll(cria)) {
    const resto = m[2];
    const comando = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(resto)?.[1]?.toUpperCase() ?? 'ALL';
    if (comando === 'ALL' || comando === 'DELETE') achadas.push(`${m[1]} (${comando})`);
  }
  return achadas;
}

/** GRANT de DELETE (ou ALL) nas duas tabelas, ou em TODAS as tabelas, ao navegador. */
function grantsQueApagam(sql: string): string[] {
  const achadas: string[] = [];
  const grant = /GRANT\s+([^;]*?)\s+ON\s+([^;]*?)\s+TO\s+([^;]*)/gi;
  for (const m of semComentarios(sql).matchAll(grant)) {
    const [, privilegios, alvo, papeis] = m;
    const daNavegacao = /\b(authenticated|anon|public)\b/i.test(papeis);
    const apaga = /\b(ALL|DELETE)\b/i.test(privilegios);
    const nasTabelas =
      new RegExp(`${TABELAS}(?![\\w])`, 'i').test(alvo) || /ALL\s+TABLES\s+IN\s+SCHEMA\s+"?public"?/i.test(alvo);
    if (daNavegacao && apaga && nasTabelas) achadas.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return achadas;
}

describe('1096 — o navegador não apaga conversa nem mensagem', () => {
  it('a 1096 tira as duas policies do upstream e o privilégio', () => {
    expect(SQL_1096).toMatch(/DROP POLICY IF EXISTS conversations_delete ON public\.conversations/);
    expect(SQL_1096).toMatch(/DROP POLICY IF EXISTS messages_modify ON public\.messages/);
    expect(SQL_1096).toMatch(/REVOKE DELETE ON public\.conversations FROM authenticated, anon/);
    expect(SQL_1096).toMatch(/REVOKE DELETE ON public\.messages FROM authenticated, anon/);
  });

  it('a escrita que fica (INSERT e UPDATE de mensagem) mantém o predicado da 1032', () => {
    const doAgente = /cb_contas_do_usuario\('agent'::public\.account_role_enum\)/g;
    const insert = /CREATE POLICY messages_insert ON public\.messages FOR INSERT([^;]*);/.exec(SQL_1096)?.[1] ?? '';
    const update = /CREATE POLICY messages_update ON public\.messages FOR UPDATE([^;]*);/.exec(SQL_1096)?.[1] ?? '';
    expect(insert.match(doAgente)).toHaveLength(1);
    expect(update.match(doAgente)).toHaveLength(2);
  });

  it('a 1096 trava messages ANTES de conversations (a ordem da ingestão)', () => {
    const sql = semComentarios(SQL_1096);
    const trava = sql.indexOf('LOCK TABLE public.messages, public.conversations');
    const primeiroDrop = sql.indexOf('DROP POLICY');
    expect(trava).toBeGreaterThan(-1);
    expect(trava).toBeLessThan(primeiroDrop);
  });

  it('o catálogo é conferido na 1096 E no fim do replay (verify-schema)', () => {
    for (const sql of [SQL_1096, VERIFY]) {
      expect(sql).toMatch(/tablename IN \('conversations', 'messages'\)\s+AND cmd IN \('DELETE', 'ALL'\)/);
      expect(sql).toMatch(/has_table_privilege\('authenticated', 'public\.messages', 'DELETE'\)/);
      expect(sql).toMatch(/has_table_privilege\('anon', 'public\.conversations', 'DELETE'\)/);
    }
  });

  it('nenhuma migration posterior devolve policy de DELETE ou FOR ALL nas duas tabelas', () => {
    const achadas = posteriores().flatMap(({ nome, sql }) =>
      policiesQueApagam(sql).map((p) => `${nome}: ${p}`),
    );
    expect(achadas).toEqual([]);
  });

  it('nenhuma migration posterior devolve o DELETE ao navegador', () => {
    const achadas = posteriores().flatMap(({ nome, sql }) =>
      grantsQueApagam(sql).map((g) => `${nome}: ${g}`),
    );
    expect(achadas).toEqual([]);
  });

  it('o detector pega as formas do upstream (prova de que não passa verde à toa)', () => {
    expect(policiesQueApagam('CREATE POLICY conversations_delete ON conversations FOR DELETE USING (true);')).toHaveLength(1);
    expect(policiesQueApagam('CREATE POLICY messages_modify ON public.messages USING (true) WITH CHECK (true);')).toHaveLength(1);
    expect(policiesQueApagam('CREATE POLICY messages_insert ON public.messages FOR INSERT WITH CHECK (true);')).toHaveLength(0);
    expect(grantsQueApagam('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;')).toHaveLength(1);
    expect(grantsQueApagam('GRANT DELETE ON public.messages TO authenticated;')).toHaveLength(1);
    expect(grantsQueApagam('GRANT ALL ON public.messages TO service_role;')).toHaveLength(0);
    // A forma que o `supabase db diff` e o pg_dump escrevem, com aspas.
    expect(policiesQueApagam('create policy "x" on "public"."messages" as permissive for delete to authenticated using (true);')).toHaveLength(1);
    expect(policiesQueApagam('CREATE POLICY y ON public."conversations" FOR DELETE USING (true);')).toHaveLength(1);
    expect(grantsQueApagam('GRANT ALL ON ALL TABLES IN SCHEMA "public" TO "authenticated";')).toHaveLength(1);
    // Tabela de nome parecido não conta.
    expect(policiesQueApagam('CREATE POLICY z ON public.messages_x FOR DELETE USING (true);')).toHaveLength(0);
  });
});
