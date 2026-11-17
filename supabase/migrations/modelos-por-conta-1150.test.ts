import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1150 — o modelo da Meta é único por CONTA e número, não por AUTOR (D4 do
// porte do upstream, 17/11/2026). A 057 do original APAGA a duplicata; aqui
// ela seria o modelo de outro número ou o vinculado à Meta: a nossa PARA com
// a lista e não apaga nada.
//
// LIMITE DECLARADO: lê o `.sql`. A prova com dado (outro autor, autor nulo,
// outro número, global ao lado do número, outra conta, idioma nulo, recusa
// com a lista e conferência do índice que sobrou) rodou num Postgres local
// com as migrations até a 1150 (`cenarios-1150.sql`, descrito no PR).
// ============================================================

const sql = fs.readFileSync(path.join(__dirname, '1150_cb_modelos_unicos_por_conta.sql'), 'utf8');
const semComentarios = sql.replace(/--.*$/gm, '');

describe('1150 — modelo único por conta e número', () => {
  it('não apaga nem muda linha nenhuma', () => {
    expect(semComentarios).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(semComentarios).not.toMatch(/\bUPDATE\s+public\./i);
    expect(semComentarios).not.toMatch(/\bTRUNCATE\b/i);
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

  it('a conferência das duplicatas vem ANTES dos índices e recusa com a lista', () => {
    const conferencia = semComentarios.indexOf('GROUP BY account_id, channel_id, name, language');
    const primeiroIndice = semComentarios.indexOf('CREATE UNIQUE INDEX');
    expect(conferencia).toBeGreaterThan(-1);
    expect(conferencia).toBeLessThan(primeiroIndice);
    expect(semComentarios).toMatch(/RAISE EXCEPTION E'1150: % modelo\(s\) repetido\(s\)/);
  });

  it('a conferência final cobra a forma dos índices e nenhum único com user_id', () => {
    expect(semComentarios).toContain('pg_get_indexdef');
    expect(semComentarios).toMatch(/AND a\.attname = 'user_id'/);
  });
});
