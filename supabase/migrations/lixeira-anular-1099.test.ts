import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// 1099 — a Lixeira só anula o ponteiro que ainda aponta para a ficha.
//
// Entre a fotografia dos ponteiros e o UPDATE, a linha de fora (negócio,
// evento, reunião…) não está travada: um pedido que troque o `contact_id`
// para outra ficha nesse intervalo teria a troca apagada se o UPDATE casasse
// só pela chave (a 1097 fazia assim; revisão do PR #429). Este pino lê a
// ÚLTIMA definição de `cb_lixeira_anular` nas migrations e exige a guarda do
// valor fotografado — quem a recriar (inclusive num merge) não a perde.
// ============================================================

const DIR = __dirname;

/** A última `CREATE OR REPLACE FUNCTION public.cb_lixeira_anular` em ordem de nome. */
function ultimaDefinicao(): { arquivo: string; corpo: string } {
  const arquivos = fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
  let achada: { arquivo: string; corpo: string } | null = null;
  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(DIR, arquivo), 'utf8');
    const re = /CREATE OR REPLACE FUNCTION public\.cb_lixeira_anular\(p jsonb\)[\s\S]*?\n\$\$;/g;
    for (const m of sql.matchAll(re)) achada = { arquivo, corpo: m[0] };
  }
  if (!achada) throw new Error('cb_lixeira_anular não encontrada');
  return achada;
}

describe('1099 — cb_lixeira_anular confere o valor fotografado', () => {
  it('a definição vigente casa pela chave E pelo valor do ponteiro (IS NOT DISTINCT FROM)', () => {
    const { arquivo, corpo } = ultimaDefinicao();
    expect(arquivo >= '1099_cb_lixeira_anular_confere_o_ponteiro.sql').toBe(true);
    expect(corpo).toContain("(e.r -> ''pk'') || (e.r -> ''v'')");
    expect(corpo).toMatch(/' IS NOT DISTINCT FROM k\.' \|\| quote_ident\(c\)/);
    expect(corpo).toMatch(/FROM unnest\(v_anula\) c\)\)\s*\n\s*USING p -> 'linhas'/);
  });

  it('a 1099 CHAMA a função num subbloco desfeito por SQLSTATE próprio (nunca WHEN OTHERS)', () => {
    const sql = fs.readFileSync(path.join(DIR, '1099_cb_lixeira_anular_confere_o_ponteiro.sql'), 'utf8');
    expect(sql).toMatch(/RAISE SQLSTATE 'P1099'/);
    expect(sql).toMatch(/EXCEPTION WHEN SQLSTATE 'P1099'/);
    expect(sql).not.toMatch(/WHEN OTHERS/);
    expect(sql).toMatch(/a troca do outro pedido foi apagada/);
  });

  it('a peça segue interna: nenhuma concessão a authenticated, anon ou PUBLIC', () => {
    const sql = fs.readFileSync(path.join(DIR, '1099_cb_lixeira_anular_confere_o_ponteiro.sql'), 'utf8');
    expect(sql).not.toMatch(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_lixeira_anular/i);
  });
});
