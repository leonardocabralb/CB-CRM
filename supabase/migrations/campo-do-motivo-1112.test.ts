import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// O campo do motivo por etapa (1112).
//
// ⚠️ O gatilho confere a CONTA e NÃO o tipo, de propósito: o upsert de
// Gerenciar funil regrava todas as etapas a cada "Salvar" (e o BEFORE INSERT
// do upsert roda até para a linha que vira UPDATE). Conferir o tipo travaria
// o salvamento de qualquer mudança do funil depois que o operador trocasse o
// tipo do campo. O tipo é conferido por quem lê (`motivo-da-etapa.ts`).
// Medido no Postgres local em 26/10/2026 (upsert com o tipo trocado passa;
// campo de outra conta é recusado no insert, no update e no upsert).
// ============================================================

const PASTA = path.resolve(__dirname);

function migration(): string {
  const achados = fs
    .readdirSync(PASTA)
    .filter((f) => /^\d{4}_cb_campo_do_motivo_da_etapa\.sql$/.test(f));
  expect(achados).toHaveLength(1);
  return fs.readFileSync(path.join(PASTA, achados[0]), 'utf8');
}

/** O corpo da função do gatilho, sem os comentários. */
function corpoDaFuncao(sql: string): string {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.cb_campo_do_motivo_da_mesma_conta[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
  );
  if (!m) throw new Error('função cb_campo_do_motivo_da_mesma_conta não encontrada');
  return m[1].replace(/--.*$/gm, '');
}

describe('campo do motivo por etapa (1112)', () => {
  it('apagar o campo zera a etapa (SET NULL), nunca apaga nem trava', () => {
    expect(migration()).toMatch(
      /ADD COLUMN IF NOT EXISTS campo_do_motivo_id uuid\s+REFERENCES public\.custom_fields\(id\) ON DELETE SET NULL/,
    );
  });

  it('o gatilho compara a conta do campo com a do funil e NÃO olha o tipo', () => {
    const corpo = corpoDaFuncao(migration());
    expect(corpo).toMatch(/FROM public\.custom_fields/);
    expect(corpo).toMatch(/FROM public\.pipelines/);
    expect(corpo).toMatch(/IS DISTINCT FROM v_conta_do_funil/);
    expect(corpo).not.toMatch(/field_type/);
  });

  it('dispara no INSERT (o upsert passa por ele) e no UPDATE da coluna', () => {
    expect(migration()).toMatch(
      /BEFORE INSERT OR UPDATE OF campo_do_motivo_id ON public\.pipeline_stages/,
    );
  });

  it('roda como quem grava e fecha o EXECUTE', () => {
    const sql = migration();
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_campo_do_motivo_da_mesma_conta\(\) FROM PUBLIC, anon, authenticated;/,
    );
  });
});
