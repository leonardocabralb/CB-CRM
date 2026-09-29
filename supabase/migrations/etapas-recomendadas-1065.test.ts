import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// ============================================================
// A contagem que alimenta o automático do botão "avançar" (1065).
//
// ⚠️ O recorte da janela é por `occurred_at`, nunca `created_at`: a carga da
// Kommo gravou a trilha retroativa em setembro de 2026 com a data histórica
// em `occurred_at` — medido em 29/09, 6.265 dos 6.273 `stage_changed` tinham
// `created_at` nos últimos 30 dias. Por `created_at`, "os últimos 30 dias"
// seriam a história inteira da Kommo, e o botão recomendaria o que o
// escritório fazia meses atrás. Não estoura em lugar nenhum.
// ============================================================

const PASTA = path.resolve(__dirname);

function migration(): string {
  const achados = fs
    .readdirSync(PASTA)
    .filter((f) => /^\d{4}_cb_etapas_recomendadas\.sql$/.test(f));
  expect(achados).toHaveLength(1);
  return fs.readFileSync(path.join(PASTA, achados[0]), 'utf8');
}

/** O corpo da função, sem os comentários. */
function corpoDaFuncao(sql: string): string {
  const m = sql.match(
    /CREATE OR REPLACE FUNCTION public\.cb_movimentos_entre_etapas[\s\S]*?AS \$\$([\s\S]*?)\$\$/,
  );
  if (!m) throw new Error('função cb_movimentos_entre_etapas não encontrada');
  return m[1].replace(/--.*$/gm, '');
}

describe('cb_movimentos_entre_etapas (1065)', () => {
  it('recorta a janela por occurred_at, e não por created_at', () => {
    const corpo = corpoDaFuncao(migration());
    expect(corpo).toMatch(/occurred_at\s*>=\s*p_desde/);
    expect(corpo).not.toMatch(/created_at/);
  });

  it('conta só movimento DENTRO do funil (de e para no mesmo funil)', () => {
    const corpo = corpoDaFuncao(migration());
    expect(corpo).toMatch(/to_pipeline_id\s*=\s*p_pipeline_id/);
    expect(corpo).toMatch(/from_pipeline_id\s*=\s*p_pipeline_id/);
    expect(corpo).toMatch(/event_type\s*=\s*'stage_changed'/);
  });

  it('roda com o privilégio de quem chama e fecha o EXECUTE nas duas metades', () => {
    const sql = migration();
    expect(sql).toMatch(/SECURITY INVOKER/);
    expect(sql).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.cb_movimentos_entre_etapas\(uuid, timestamptz\)\s+FROM PUBLIC, anon, authenticated;/,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.cb_movimentos_entre_etapas\(uuid, timestamptz\)\s+TO authenticated, service_role;/,
    );
  });
});
