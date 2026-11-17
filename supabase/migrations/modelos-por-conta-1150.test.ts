import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1150 — o modelo da Meta é único por CONTA e número, não por AUTOR (D4 do
// porte do upstream, 17/11/2026). A 057 do original APAGA a duplicata; aqui
// ela seria o modelo de outro número ou o vinculado à Meta: a nossa PARA com
// a lista e não apaga nada.
//
// Apagar a CONEXÃO: o SET NULL da FK faria dos modelos dela globais, e o
// que repete uma global daria 23505 — o gatilho `cb_channels_solta_modelos`
// apaga SÓ essa linha (a global fica) e anula as outras.
//
// LIMITE DECLARADO: lê o `.sql`. A prova com dado (outro autor, autor nulo,
// outro número, global ao lado do número, outra conta, idioma nulo, recusa
// com a lista, conferência do índice que sobrou, conexão apagada com e sem
// global e duas conexões numa instrução) rodou num Postgres local com as
// migrations até a 1150 (`cenarios-1150.sql`, descrito no PR); a própria
// migration chama o gatilho numa prova desfeita quando há conta.
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1150_cb_modelos_unicos_por_conta.sql'), 'utf8');
const semComentarios = sql.replace(/--.*$/gm, '');

// O corpo da função do gatilho (roda só quando uma conexão é apagada) e a
// prova desfeita (o bloco DO do 'P1150'): fora deles, nada escreve em linha.
const inicioDaFuncao = semComentarios.indexOf(
  'CREATE OR REPLACE FUNCTION public.cb_solta_modelos_da_conexao()',
);
const corpoDaFuncao = semComentarios.slice(
  inicioDaFuncao,
  semComentarios.indexOf('$$;', semComentarios.indexOf('AS $$', inicioDaFuncao)) + 3,
);
const marcaDaProva = semComentarios.indexOf("ERRCODE = 'P1150'");
const inicioDaProva = semComentarios.lastIndexOf('DO $$', marcaDaProva);
const prova = semComentarios.slice(
  inicioDaProva,
  semComentarios.indexOf('END $$;', marcaDaProva) + 'END $$;'.length,
);
const aplicada = semComentarios.replace(corpoDaFuncao, '').replace(prova, '');

describe('1150 — modelo único por conta e número', () => {
  it('ao ser aplicada, não apaga nem muda linha nenhuma', () => {
    expect(inicioDaFuncao).toBeGreaterThan(-1);
    expect(prova).toContain("ERRCODE = 'P1150'");
    expect(aplicada).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(aplicada).not.toMatch(/\bUPDATE\s+(public\.)?\w+\s+SET\b/i);
    expect(semComentarios).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('conexão apagada: o gatilho BEFORE DELETE, na forma da 1077', () => {
    expect(semComentarios).toMatch(
      /CREATE TRIGGER cb_channels_solta_modelos\s+BEFORE DELETE ON public\.cb_channels\s+FOR EACH ROW EXECUTE FUNCTION public\.cb_solta_modelos_da_conexao\(\);/,
    );
    expect(corpoDaFuncao).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(corpoDaFuncao).toContain('RETURN OLD;');
    expect(semComentarios).toContain(
      'REVOKE EXECUTE ON FUNCTION public.cb_solta_modelos_da_conexao() FROM PUBLIC, anon, authenticated;',
    );
  });

  it('o gatilho apaga SÓ a linha da conexão que repetiria uma global; as outras viram globais', () => {
    expect(corpoDaFuncao.match(/\bDELETE\b/g)).toHaveLength(1);
    expect(corpoDaFuncao).toMatch(
      /DELETE FROM message_templates t\s+WHERE t\.channel_id = OLD\.id\s+AND EXISTS \(/,
    );
    expect(corpoDaFuncao).toMatch(
      /g\.account_id = t\.account_id\s+AND g\.channel_id IS NULL\s+AND g\.name = t\.name\s+AND g\.language IS NOT DISTINCT FROM t\.language/,
    );
    expect(corpoDaFuncao).toMatch(
      /UPDATE message_templates\s+SET channel_id = NULL\s+WHERE channel_id = OLD\.id;/,
    );
  });

  it('a prova CHAMA o gatilho e se desfaz pelo SQLSTATE próprio, nunca WHEN OTHERS', () => {
    expect(prova).toMatch(/DELETE FROM public\.cb_channels WHERE id = v_canal;/);
    expect(prova).toMatch(/RAISE EXCEPTION USING ERRCODE = 'P1150'/);
    expect(prova).toMatch(/EXCEPTION WHEN SQLSTATE 'P1150' THEN\s+NULL;/);
    expect(prova).toMatch(/RAISE NOTICE '1150: banco sem conta, nada a provar\.'/);
    expect(semComentarios).not.toMatch(/WHEN OTHERS/i);
  });

  it('os dois índices por conta, com a régua da 903 (número × global) e NULLS NOT DISTINCT', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS message_templates_conta_canal_nome_idioma_key\s+ON public\.message_templates \(account_id, channel_id, name, language\) NULLS NOT DISTINCT\s+WHERE channel_id IS NOT NULL;/,
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS message_templates_conta_nome_idioma_global_key\s+ON public\.message_templates \(account_id, name, language\) NULLS NOT DISTINCT\s+WHERE channel_id IS NULL;/,
    );
  });

  it('os por autor da 903 saem', () => {
    expect(sql).toContain('DROP INDEX IF EXISTS public.message_templates_user_name_lang_global_key;');
    expect(sql).toContain('DROP INDEX IF EXISTS public.message_templates_user_name_lang_channel_key;');
  });

  it('⚠️ a trava EXCLUSIVA (DROP INDEX) vem DEPOIS da prova, e depois dela só catálogo', () => {
    // O DROP INDEX segura até a LEITURA de `message_templates` até o COMMIT
    // (supabase.md): a prova, que escreve em `cb_channels` com as ações das
    // FKs, roda antes dele.
    const primeiroDrop = semComentarios.indexOf('DROP INDEX');
    expect(inicioDaProva).toBeGreaterThan(-1);
    expect(primeiroDrop).toBeGreaterThan(inicioDaProva + prova.length);
    const depoisDaTrava = semComentarios.slice(primeiroDrop);
    expect(depoisDaTrava).not.toMatch(/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+(public\.)?\w+\s+SET)\b/i);
    // Instrução, não o texto que a conferência compara (`'CREATE UNIQUE INDEX…'`).
    expect(depoisDaTrava).not.toMatch(/^\s*CREATE\s+(UNIQUE\s+)?INDEX\b/im);
  });

  it('a conferência das duplicatas vem ANTES dos índices e recusa com a lista', () => {
    const conferencia = semComentarios.indexOf('GROUP BY account_id, channel_id, name, language');
    const primeiroIndice = semComentarios.indexOf('CREATE UNIQUE INDEX');
    expect(conferencia).toBeGreaterThan(-1);
    expect(conferencia).toBeLessThan(primeiroIndice);
    expect(semComentarios).toMatch(/RAISE EXCEPTION E'1150: % modelo\(s\) repetido\(s\)/);
  });

  it('a conferência final cobra a forma dos índices, nenhum único com user_id e o gatilho de pé', () => {
    expect(semComentarios).toContain('pg_get_indexdef');
    expect(semComentarios).toMatch(/AND a\.attname = 'user_id'/);
    expect(semComentarios).toMatch(/WHERE tgname = 'cb_channels_solta_modelos'/);
    expect(semComentarios).toMatch(/has_function_privilege\('anon', 'public\.cb_solta_modelos_da_conexao\(\)', 'EXECUTE'\)/);
  });
});
