import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1100 — contato só sai pela Lixeira (Fase 3 de
// docs/PLANO-lixeira-de-contatos.md).
//
// Desde a 1097, excluir contato é MOVER para a Lixeira
// (`cb_mover_contatos_para_lixeira`, SECURITY DEFINER, admin por dentro). A
// 1100 derruba a policy `contacts_delete` (981; a original é do upstream,
// 0017) e revoga o DELETE de `authenticated` e `anon`: um DELETE direto pelo
// PostgREST apagaria a ficha com a conversa e as mensagens SEM fotografia,
// sem volta.
//
// Duas metades, como a 1096 (`portas-dos-fundos-1096.test.ts`):
//   • os `.sql` posteriores à 1100 não devolvem a policy nem o privilégio
//     (o caminho provável é um merge do upstream, que traz a 0017 crua);
//   • nenhum código do app (`src/`, fora os testes) chama `.delete()` em
//     `contacts` — a página crua do upstream num merge voltaria a tentar, e
//     com a 1100 receberia 42501 em vez de mover para a Lixeira.
//
// LIMITE DECLARADO: lê o texto. Policy ou GRANT por `EXECUTE` dentro de um DO
// fica invisível — o `supabase/ci/verify-schema.sql` confere o CATÁLOGO no
// fim do replay. No `src/`, o `.from(...)` com o nome da tabela numa
// variável escapa; o 42501 do banco é a cerca de verdade.
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1100_cb_so_a_lixeira_apaga_contato.sql';
const SQL_1099 = fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8');
const VERIFY = fs.readFileSync(path.join(DIR, '..', 'ci', 'verify-schema.sql'), 'utf8');
const SRC = path.join(DIR, '..', '..', 'src');

/** Com ou sem aspas: `public.contacts`, `"public"."contacts"`, `contacts`. */
const TABELA = '(?:"?public"?\\.)?"?contacts"?';

/** Migrations numeradas DEPOIS da 1100, em ordem de nome (a do replay). */
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

/** Policy de DELETE ou FOR ALL (CREATE POLICY sem `FOR` também é ALL) em `contacts`. */
function policiesQueApagam(sql: string): string[] {
  const achadas: string[] = [];
  const cria = new RegExp(`CREATE\\s+POLICY\\s+("[^"]+"|\\w+)\\s+ON\\s+${TABELA}(?![\\w])([^;]*)`, 'gi');
  for (const m of semComentarios(sql).matchAll(cria)) {
    const comando = /\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i.exec(m[2])?.[1]?.toUpperCase() ?? 'ALL';
    if (comando === 'ALL' || comando === 'DELETE') achadas.push(`${m[1]} (${comando})`);
  }
  return achadas;
}

/** GRANT de DELETE (ou ALL) em `contacts`, ou em TODAS as tabelas, ao navegador. */
function grantsQueApagam(sql: string): string[] {
  const achadas: string[] = [];
  const grant = /GRANT\s+([^;]*?)\s+ON\s+([^;]*?)\s+TO\s+([^;]*)/gi;
  for (const m of semComentarios(sql).matchAll(grant)) {
    const [, privilegios, alvo, papeis] = m;
    const daNavegacao = /\b(authenticated|anon|public)\b/i.test(papeis);
    const apaga = /\b(ALL|DELETE)\b/i.test(privilegios);
    const naTabela =
      new RegExp(`(?:^|[\\s,])${TABELA}(?![\\w])`, 'i').test(alvo) ||
      /ALL\s+TABLES\s+IN\s+SCHEMA\s+"?public"?/i.test(alvo);
    if (daNavegacao && apaga && naTabela) achadas.push(m[0].replace(/\s+/g, ' ').trim());
  }
  return achadas;
}

/** Arquivos `.ts`/`.tsx` de `src/`, fora os testes. */
function fontes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return fontes(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

/**
 * `.from('contacts')` (aspas simples, duplas ou crase) seguido de `.delete(`
 * na MESMA cadeia: o trecho vai até o próximo `.from(` ou `;`.
 */
function apagaContato(fonte: string): number {
  let achadas = 0;
  const de = /\.from\(\s*(['"`])contacts\1\s*\)/g;
  for (const m of fonte.matchAll(de)) {
    const resto = fonte.slice(m.index + m[0].length);
    const fim = resto.search(/;|\.from\(/);
    const cadeia = fim === -1 ? resto : resto.slice(0, fim);
    if (/\.delete\(/.test(cadeia)) achadas += 1;
  }
  return achadas;
}

describe('1100 — contato só sai pela Lixeira', () => {
  it('a 1100 derruba a policy e revoga o DELETE do navegador', () => {
    expect(SQL_1099).toMatch(/DROP POLICY IF EXISTS contacts_delete ON public\.contacts/);
    expect(SQL_1099).toMatch(/REVOKE DELETE ON public\.contacts FROM authenticated, anon/);
  });

  it('a 1100 mantém cadastrar e corrigir (INSERT e UPDATE) e a Lixeira como porta', () => {
    expect(SQL_1099).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.contacts TO authenticated/);
    expect(SQL_1099).toMatch(/cb_mover_contatos_para_lixeira\(uuid\[\], uuid\)/);
  });

  it('o catálogo é conferido na 1100 E no fim do replay (verify-schema)', () => {
    for (const sql of [SQL_1099, VERIFY]) {
      expect(sql).toMatch(/tablename = 'contacts' AND cmd IN \('DELETE', 'ALL'\)/);
      expect(sql).toMatch(/has_table_privilege\('authenticated', 'public\.contacts', 'DELETE'\)/);
      expect(sql).toMatch(/has_table_privilege\('anon', 'public\.contacts', 'DELETE'\)/);
    }
  });

  it('nenhuma migration posterior devolve policy de DELETE ou FOR ALL em contacts', () => {
    const achadas = posteriores().flatMap(({ nome, sql }) =>
      policiesQueApagam(sql).map((p) => `${nome}: ${p}`),
    );
    expect(achadas).toEqual([]);
  });

  it('nenhuma migration posterior devolve o DELETE de contacts ao navegador', () => {
    const achadas = posteriores().flatMap(({ nome, sql }) =>
      grantsQueApagam(sql).map((g) => `${nome}: ${g}`),
    );
    expect(achadas).toEqual([]);
  });

  it('nenhum código do app apaga contato direto (excluir é mover para a Lixeira)', () => {
    const achadas = fontes(SRC)
      .filter((f) => apagaContato(fs.readFileSync(f, 'utf8')) > 0)
      .map((f) => path.relative(SRC, f));
    expect(achadas).toEqual([]);
  });

  it('os detectores pegam as formas do upstream (prova de que não passam verdes à toa)', () => {
    expect(policiesQueApagam('CREATE POLICY contacts_delete ON contacts FOR DELETE USING (true);')).toHaveLength(1);
    expect(policiesQueApagam('create policy "x" on "public"."contacts" as permissive for delete to authenticated using (true);')).toHaveLength(1);
    expect(policiesQueApagam('CREATE POLICY contacts_all ON public.contacts USING (true);')).toHaveLength(1);
    expect(policiesQueApagam('CREATE POLICY contacts_update ON public.contacts FOR UPDATE USING (true);')).toHaveLength(0);
    expect(policiesQueApagam('CREATE POLICY y ON public.contacts_x FOR DELETE USING (true);')).toHaveLength(0);
    expect(grantsQueApagam('GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;')).toHaveLength(1);
    expect(grantsQueApagam('GRANT DELETE ON public.contacts TO authenticated;')).toHaveLength(1);
    expect(grantsQueApagam('GRANT ALL ON public.contacts TO service_role;')).toHaveLength(0);
    expect(grantsQueApagam('GRANT DELETE ON public.cb_contatos_relacionados TO authenticated;')).toHaveLength(0);

    expect(apagaContato("await supabase.from('contacts').delete().in('id', ids);")).toBe(1);
    expect(apagaContato('supabase\n  .from("contacts")\n  .delete({ count: "exact" })\n  .eq("id", id)')).toBe(1);
    expect(apagaContato("supabase.from('contacts').select('id').eq('id', id); supabase.from('tags').delete()")).toBe(0);
    expect(apagaContato("supabase.from('contact_tags').delete().eq('contact_id', id)")).toBe(0);
  });
});
