import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// ============================================================
// 1102 — anotação com anexos. A conferência da própria migration prova o
// banco quando ela é APLICADA; este pino avisa no PR, lendo os `.sql`, o que
// uma migration posterior (ou um merge) desfaria em silêncio:
//
// (a) o gatilho dos anexos tem o WHEN do sinal da Lixeira e está nos
//     `calados` do tratamento VIGENTE — sem o WHEN, mover a ficha mandaria
//     os anexos para a fila (o arquivo sumiria com a ficha na Lixeira); sem a
//     declaração, toda restauração recusaria;
// (b) as regras da anotação usam CASE (o Postgres não garante a ordem do
//     AND, e `jsonb_array_length` estoura em não-lista);
// (c) DEFAULT-DENY no armazenamento: a ÚLTIMA definição das policies de
//     TROCAR e APAGAR do `chat-media`, no replay inteiro, ainda fecha
//     `notas/` (ninguém troca; só o dono apaga) e usa `IS DISTINCT FROM`
//     nas pastas — uma migration que recrie a da 954 reabriria a porta;
// (d) a conferência CHAMA o gatilho, desfeita pelo SQLSTATE próprio, sem
//     `WHEN OTHERS`, e as policies de `storage.objects` vêm DEPOIS dela (a
//     trava exclusiva da tabela quente dura só até o COMMIT).
// ============================================================

const DIR = __dirname;
const ARQUIVO = '1102_cb_anotacao_com_anexos.sql';

const semComentarios = (sql: string) => sql.replace(/--[^\n]*/g, '');
const SQL = semComentarios(fs.readFileSync(path.join(DIR, ARQUIVO), 'utf8'));
const MIGRATIONS = fs
  .readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((arquivo) => ({
    arquivo,
    sql: semComentarios(fs.readFileSync(path.join(DIR, arquivo), 'utf8')),
  }));

const SINAL = "nullif(current_setting('cb.lixeira', true), '') IS NULL";

function corpoDaFuncao(sql: string, nome: string): string | null {
  const inicio = sql.search(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${nome}\\s*\\(`, 'i')
  );
  if (inicio < 0) return null;
  const resto = sql.slice(inicio);
  const abre = resto.indexOf('$$');
  return resto.slice(0, resto.indexOf('$$', abre + 2) + 2);
}

/** A ÚLTIMA criação de uma policy de `storage.objects`, no replay inteiro. */
function ultimaPolicy(nome: string): { arquivo: string; texto: string } | null {
  let ultima: { arquivo: string; texto: string } | null = null;
  const cria = new RegExp(`CREATE\\s+POLICY\\s+"${nome}"\\s+ON\\s+storage\\.objects\\b([^;]*);`, 'gi');
  for (const m of MIGRATIONS) {
    for (const achado of m.sql.matchAll(cria)) ultima = { arquivo: m.arquivo, texto: achado[1] };
  }
  return ultima;
}

describe('1102 — anotação com anexos', () => {
  it('(a) o gatilho: AFTER DELETE OR UPDATE OF anexos, por linha, com EXATAMENTE o WHEN do sinal', () => {
    const gatilho = SQL.match(
      /CREATE\s+OR\s+REPLACE\s+TRIGGER\s+cb_anexos_da_anotacao_para_a_fila\b([^;]*);/i
    );
    expect(gatilho).not.toBeNull();
    expect(gatilho![1]).toMatch(/AFTER\s+DELETE\s+OR\s+UPDATE\s+OF\s+anexos\s+ON\s+public\.cb_conversation_notes\s+FOR\s+EACH\s+ROW/i);
    expect(gatilho![1]).toContain(`WHEN (${SINAL})`);
  });

  it('(a) e o tratamento VIGENTE da Lixeira o declara nos calados', () => {
    let vigente: string | null = null;
    for (const m of MIGRATIONS) vigente = corpoDaFuncao(m.sql, 'cb_lixeira_tratamento') ?? vigente;
    const calados = vigente!.slice(vigente!.indexOf("'calados'"), vigente!.indexOf("'livres'"));
    expect(calados).toContain("'cb_conversation_notes.cb_anexos_da_anotacao_para_a_fila'");
  });

  it('(a) a função do gatilho: SECURITY DEFINER, search_path fixo, prefixo notas/ e a guarda da 1097, ON CONFLICT', () => {
    const f = corpoDaFuncao(SQL, 'cb_anexos_da_anotacao_para_a_fila')!;
    expect(f).toMatch(/SECURITY\s+DEFINER/i);
    expect(f).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(f).toContain("'/notas/'");
    expect(f).toContain('cb_caminho_no_chat_media(');
    expect(f).toMatch(/ON\s+CONFLICT\s+\(bucket,\s*caminho\)\s+DO\s+NOTHING/i);
    // NEW só no ramo do UPDATE (no DELETE ele não existe).
    expect(f).toMatch(/IF\s+TG_OP\s*=\s*'UPDATE'\s+THEN\s+v_ficam\s*:=[^;]*NEW\.anexos/i);
    expect(SQL).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_anexos_da_anotacao_para_a_fila\(\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated\s*;/i
    );
  });

  it('(b) as regras: texto OU anexo; lista de até 10 — com CASE; e o CHECK de só-texto sai pela FORMA', () => {
    expect(SQL).toMatch(
      /cb_conversation_notes_conteudo_ck\s+CHECK\s*\(\s*CASE\s+WHEN\s+btrim\(texto\)\s*<>\s*''\s+THEN\s+true\s+WHEN\s+jsonb_typeof\(anexos\)\s*=\s*'array'\s+THEN\s+jsonb_array_length\(anexos\)\s*>=\s*1\s+ELSE\s+false\s+END\s*\)/i
    );
    expect(SQL).toMatch(
      /cb_conversation_notes_anexos_ck\s+CHECK\s*\(\s*CASE\s+WHEN\s+jsonb_typeof\(anexos\)\s*=\s*'array'\s+THEN\s+jsonb_array_length\(anexos\)\s*<=\s*10\s+ELSE\s+false\s+END\s*\)/i
    );
    expect(SQL).toContain("pg_get_constraintdef(c.oid) = 'CHECK ((btrim(texto) <> ''''::text))'");
  });

  it('(c) DEFAULT-DENY: a última policy de TROCAR do chat-media fecha notas/', () => {
    const p = ultimaPolicy('Members can update chat media');
    expect(p?.arquivo).toBeDefined();
    expect(p!.arquivo >= ARQUIVO).toBe(true);
    expect(p!.texto).toMatch(/FOR\s+UPDATE/i);
    expect(p!.texto).toContain("(storage.foldername(name))[2] IS DISTINCT FROM 'notas'");
    expect(p!.texto).toContain("(storage.foldername(name))[2] IS DISTINCT FROM 'acervo'");
  });

  it('(c) DEFAULT-DENY: a última policy de APAGAR do chat-media deixa só o DONO apagar em notas/', () => {
    const p = ultimaPolicy('Members can delete chat media');
    expect(p!.arquivo >= ARQUIVO).toBe(true);
    expect(p!.texto).toMatch(/FOR\s+DELETE/i);
    expect(p!.texto).toMatch(
      /WHEN\s+\(storage\.foldername\(name\)\)\[2\]\s+IS\s+NOT\s+DISTINCT\s+FROM\s+'notas'\s+THEN\s+objects\.owner_id\s*=\s*auth\.uid\(\)::text/i
    );
    expect(p!.texto).toContain("(storage.foldername(name))[2] IS DISTINCT FROM 'acervo'");
  });

  it('(c) nenhuma policy de storage da 1102 compara pasta com <> (a segunda pasta de anexo comum é NULA)', () => {
    for (const m of SQL.matchAll(/CREATE\s+POLICY[^;]*;/gi)) {
      expect(m[0]).not.toMatch(/foldername\([^)]*\)\)\[\d\]\s*<>/);
    }
  });

  it('(c) gravar continua aberto a todo membro: a 1102 não recria a policy de INSERT', () => {
    expect(SQL).not.toMatch(/CREATE\s+POLICY\s+"Members can upload chat media"/i);
  });

  it('(d) a conferência CHAMA o gatilho num subbloco desfeito por P1102, sem WHEN OTHERS', () => {
    expect(SQL).toMatch(/RAISE\s+EXCEPTION\s+USING\s+ERRCODE\s*=\s*'P1102'/);
    expect(SQL).toMatch(/WHEN\s+SQLSTATE\s+'P1102'\s+THEN/);
    expect(SQL).not.toMatch(/WHEN\s+OTHERS/i);
    expect(SQL).toMatch(/DELETE\s+FROM\s+public\.cb_conversation_notes/);
    expect(SQL).toContain("set_config('cb.lixeira', 'movendo', true)");
  });

  it('(d) as policies de storage.objects vêm DEPOIS de toda escrita da conferência', () => {
    const primeiraPolicy = SQL.search(/DROP\s+POLICY\s+IF\s+EXISTS\s+"Members can update chat media"/i);
    const ultimaEscrita = SQL.lastIndexOf('DELETE FROM public.cb_conversation_notes');
    expect(primeiraPolicy).toBeGreaterThan(ultimaEscrita);
    expect(SQL.search(/SET\s+LOCAL\s+lock_timeout/i)).toBeLessThan(SQL.search(/ALTER\s+TABLE/i));
  });
});
