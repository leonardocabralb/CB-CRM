import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CASOU_POR, ORIGENS_DO_VINCULO } from '../../src/lib/atlas/leitura';

// ============================================================
// 1072 — a leitura das situações do Atlas e o vínculo por ambiente. O que
// este pino segura:
//
// 1. As chaves 1:1 valem POR AMBIENTE, com o nulo (o Atlas de verdade)
//    contando como um ambiente (NULLS NOT DISTINCT) — sem isso, duas linhas
//    de produção com o mesmo cliente passariam, porque NULL ≠ NULL. A da
//    ficha é PARCIAL: as órfãs (ficha apagada) continuam convivendo.
// 2. `cb_atlas_recusas` é FECHADA ao navegador: RLS, nenhuma policy.
// 3. As listas dos CHECKs são o espelho das constantes do código: origem
//    nova no TS sem a migration seria recusada pelo banco em produção.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1072_cb_atlas_leitura_e_vinculo.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');

function listaDoCheck(nome: string): string[] {
  const corpo = CODIGO.match(new RegExp(`CONSTRAINT ${nome}\\s+CHECK \\(([^;]*)\\);`))?.[1] ?? '';
  const dentro = corpo.match(/IN \(([^)]*)\)/)?.[1] ?? '';
  return [...dentro.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('1072 — Atlas, leitura e vínculo', () => {
  it('as chaves 1:1 são por AMBIENTE, NULLS NOT DISTINCT; a da ficha é parcial', () => {
    expect(CODIGO).toMatch(
      /ADD CONSTRAINT cb_atlas_clientes_cliente_key\s+UNIQUE NULLS NOT DISTINCT \(account_id, api_url, atlas_client_id\);/,
    );
    expect(CODIGO).toMatch(/DROP CONSTRAINT IF EXISTS cb_atlas_clientes_contato_key;/);
    expect(CODIGO).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS cb_atlas_clientes_contato_key\s+ON cb_atlas_clientes \(account_id, api_url, contact_id\) NULLS NOT DISTINCT\s+WHERE contact_id IS NOT NULL;/,
    );
    expect(CODIGO).toMatch(/CONSTRAINT cb_atlas_recusas_key UNIQUE NULLS NOT DISTINCT \(account_id, api_url, contact_id, atlas_client_id\)/);
  });

  it('as recusas são fechadas ao navegador, sem policy, e somem com a ficha', () => {
    expect(CODIGO).toMatch(/ALTER TABLE cb_atlas_recusas ENABLE ROW LEVEL SECURITY;/);
    expect(CODIGO).toContain('REVOKE ALL ON TABLE cb_atlas_recusas FROM PUBLIC, anon, authenticated;');
    expect(CODIGO).toContain('GRANT ALL ON TABLE cb_atlas_recusas TO service_role;');
    expect(CODIGO).not.toMatch(/CREATE POLICY/);
    expect(CODIGO).not.toMatch(/GRANT[^;]*ON TABLE cb_atlas_recusas TO (authenticated|anon)/);
    expect(CODIGO).toMatch(/REFERENCES contacts \(id, account_id\) ON DELETE CASCADE;/);
  });

  it('o CHECK da origem é o espelho de ORIGENS_DO_VINCULO', () => {
    expect(listaDoCheck('cb_atlas_clientes_origem_ck')).toEqual([...ORIGENS_DO_VINCULO]);
  });

  it('o CHECK de casou_por é o espelho de CASOU_POR (e aceita nulo)', () => {
    expect(listaDoCheck('cb_atlas_clientes_casou_por_ck')).toEqual([...CASOU_POR]);
    expect(CODIGO).toMatch(/CHECK \(casou_por IS NULL OR casou_por IN/);
  });

  it('só colunas NOVAS e anuláveis (aditiva: o app da Fase 0 continua gravando)', () => {
    const adicionadas = [...CODIGO.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)\s+([^,;]+)/g)];
    expect(adicionadas.length).toBeGreaterThanOrEqual(17);
    for (const [, nome, tipo] of adicionadas) expect(`${nome}: ${tipo}`).not.toMatch(/NOT NULL/);
    for (const c of ['api_url', 'situacao_desde', 'casou_por', 'visto_na_listagem_em', 'crm_escreveu_em', 'excluido_no_atlas_em', 'mudancas_desde', 'mudancas_cursor', 'mudancas_iniciada_em']) {
      expect(CODIGO).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${c}\\s`));
    }
  });

  it('as conferências leem só o catálogo (valem num banco vazio)', () => {
    const conferencias = CODIGO.slice(CODIGO.lastIndexOf('DO $$'));
    expect(conferencias).not.toMatch(/FROM\s+(public\.)?cb_atlas_(clientes|recusas|config)\b/);
    expect(conferencias).toMatch(/indnullsnotdistinct/);
  });
});
