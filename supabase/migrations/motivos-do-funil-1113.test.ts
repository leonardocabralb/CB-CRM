import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// O relatório de motivos do Desempenho (1113).
//
// Provado no Postgres local em 26/10/2026, depois do replay completo (soma
// por etapa e motivo, período, outra conta não vê, etapa sem campo e card
// apagado fora, card criado direto na etapa conta) e medido na produção (só
// leitura). O pino segura o que a prova não repete sozinha: a RLS de quem
// chama, o índice do recorte e a leitura do valor pelo índice único.
// ============================================================

const PASTA = path.resolve(__dirname);

function migration(): string {
  const achados = fs.readdirSync(PASTA).filter((f) => /^\d{4}_cb_motivos_do_funil\.sql$/.test(f));
  expect(achados).toHaveLength(1);
  return fs.readFileSync(path.join(PASTA, achados[0]), 'utf8');
}

/** O corpo da função, sem os comentários. */
function corpo(sql: string): string {
  const m = sql.match(/CREATE OR REPLACE FUNCTION public\.cb_motivos_do_funil[\s\S]*?AS \$\$([\s\S]*?)\$\$/);
  if (!m) throw new Error('função cb_motivos_do_funil não encontrada');
  return m[1].replace(/--.*$/gm, '');
}

describe('relatório de motivos (1113)', () => {
  it('roda com a RLS de quem chama e fecha o anon', () => {
    const sql = migration();
    expect(sql).toMatch(/LANGUAGE sql\s+STABLE\s+SECURITY INVOKER\s+SET search_path = public/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.cb_motivos_do_funil\([^)]*\)\s+FROM PUBLIC, anon;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.cb_motivos_do_funil\([^)]*\)\s+TO authenticated, service_role;/);
  });

  it('o recorte repete o predicado do índice parcial cb_lead_events_funil_idx', () => {
    // (to_pipeline_id, occurred_at) WHERE deal_id IS NOT NULL: sem o
    // predicado, o planejador não usa o índice e varre a trilha inteira.
    const c = corpo(migration());
    expect(c).toMatch(/e\.to_pipeline_id = p_pipeline_id/);
    expect(c).toMatch(/e\.deal_id IS NOT NULL/);
  });

  it('conta CARDS: a última entrada de cada card em cada etapa', () => {
    const c = corpo(migration());
    expect(c).toMatch(/DISTINCT ON \(e\.deal_id, e\.to_stage_id\)/);
    expect(c).toMatch(/ORDER BY e\.deal_id, e\.to_stage_id, e\.occurred_at DESC, e\.id DESC/);
    expect(c).toMatch(/event_type IN \('deal_created', 'stage_changed', 'pipeline_changed'\)/);
  });

  it('o valor vem por subconsulta com contato E campo (o índice único), do contato ATUAL do card', () => {
    // A junção solta usava só o contato e lia a ficha inteira (~400 ms → ~7 ms).
    const c = corpo(migration());
    expect(c).toMatch(
      /\(SELECT v\.value\s+FROM contact_custom_values v\s+WHERE v\.contact_id = d\.contact_id\s+AND v\.custom_field_id = s\.campo_do_motivo_id\)/,
    );
    expect(c).toMatch(/JOIN deals d ON d\.id = en\.deal_id/);
  });

  it('quem levou só vem na linha SEM motivo', () => {
    const c = corpo(migration());
    for (const coluna of ['l.origin', 'l.actor_user_id', 'l.actor_label']) {
      expect(c).toContain(`CASE WHEN l.motivo IS NULL THEN ${coluna} END`);
    }
  });
});
