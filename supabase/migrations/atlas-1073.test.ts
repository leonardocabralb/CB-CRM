import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ESTADOS_DA_MUDANCA, RESULTADOS_DA_MUDANCA } from '../../src/lib/atlas/gatilho';

// ============================================================
// 1073 — a fila das mudanças de situação do Atlas (Fase 4). O que este pino
// segura:
//
// 1. As listas dos CHECKs são o ESPELHO das constantes do código: resultado
//    novo no TS sem a migration seria recusado pelo banco na produção, e a
//    mudança ficaria `processando` até o recolhimento.
// 2. Sem `antiga` nem `suspeita_ficha_velha` (o operador recusou as duas
//    travas, 30/09/2026).
// 3. A chave única é POR AMBIENTE, NULLS NOT DISTINCT (nulo = o Atlas de
//    verdade), e segura a sobreposição da leitura.
// 4. A fila é FECHADA ao navegador e não tem `contact_id` (fora da receita
//    de fusão).
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1073_cb_atlas_mudancas.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');
const TABELA = CODIGO.match(/CREATE TABLE IF NOT EXISTS cb_atlas_mudancas \(([\s\S]*?)\n\);/)?.[1] ?? '';

function listaDoCheck(nome: string): string[] {
  const corpo = TABELA.match(new RegExp(`CONSTRAINT ${nome}\\s+CHECK \\(([^\\n]*)\\)`))?.[1] ?? '';
  const dentro = corpo.match(/IN \(([^)]*)\)/)?.[1] ?? '';
  return [...dentro.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('1073 — Atlas, fila das mudanças', () => {
  it('a colheita achou a tabela (senão os testes abaixo passariam vazios)', () => {
    expect(TABELA).toContain('situacao_desde');
  });

  it('o CHECK do resultado é o espelho de RESULTADOS_DA_MUDANCA, sem as travas recusadas', () => {
    expect(listaDoCheck('cb_atlas_mudancas_resultado_ck')).toEqual([...RESULTADOS_DA_MUDANCA]);
    expect(RESULTADOS_DA_MUDANCA).not.toContain('antiga');
    expect(RESULTADOS_DA_MUDANCA).not.toContain('suspeita_ficha_velha');
    expect(TABELA).toMatch(/CHECK \(resultado IS NULL OR resultado IN/);
  });

  it('o CHECK do estado é o espelho de ESTADOS_DA_MUDANCA', () => {
    expect(listaDoCheck('cb_atlas_mudancas_estado_ck')).toEqual([...ESTADOS_DA_MUDANCA]);
  });

  it('a chave é por AMBIENTE, NULLS NOT DISTINCT, e a data da mudança é obrigatória', () => {
    expect(TABELA).toMatch(/CONSTRAINT cb_atlas_mudancas_key UNIQUE NULLS NOT DISTINCT \(account_id, api_url, atlas_client_id, situacao_desde\)/);
    expect(TABELA).toMatch(/situacao_desde\s+timestamptz NOT NULL/);
    expect(TABELA).toMatch(/\n\s+api_url\s+text,/);
  });

  it('sem contact_id (fora da receita de fusão)', () => {
    expect(TABELA).not.toMatch(/contact_id/);
  });

  it('fechada ao navegador, sem policy', () => {
    expect(CODIGO).toMatch(/ALTER TABLE cb_atlas_mudancas ENABLE ROW LEVEL SECURITY;/);
    expect(CODIGO).toContain('REVOKE ALL ON TABLE cb_atlas_mudancas FROM PUBLIC, anon, authenticated;');
    expect(CODIGO).toContain('GRANT ALL ON TABLE cb_atlas_mudancas TO service_role;');
    expect(CODIGO).not.toMatch(/CREATE POLICY/);
    expect(CODIGO).not.toMatch(/GRANT[^;]*ON TABLE cb_atlas_mudancas TO (authenticated|anon)/);
  });

  it('as conferências leem só o catálogo (valem num banco vazio)', () => {
    const conferencias = CODIGO.slice(CODIGO.lastIndexOf('DO $$'));
    expect(conferencias).not.toMatch(/FROM\s+(public\.)?cb_atlas_mudancas\b/);
    expect(conferencias).toMatch(/indnullsnotdistinct/);
  });
});
