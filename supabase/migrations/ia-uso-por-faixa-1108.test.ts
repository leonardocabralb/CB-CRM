import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { LIMIAR_DA_FAIXA } from '../../src/lib/ia-agentes/precos';

// ============================================================
// 1108 — a soma do uso de IA separa a FAIXA do pedido (o preço do Haiku 5.5).
// O que este pino segura (a conferência de dentro da migration confere o
// catálogo e os privilégios, não a forma):
//
// 1. O corte do banco é o MESMO `LIMIAR_DA_FAIXA` do TS: o banco só sabe
//    separar num número, e a tabela de preço fala dele.
// 2. A faixa entra no GROUP BY e no ORDER BY (a ordem total que a rota pagina)
//    — e a rota ordena pelas SEIS chaves.
// 3. DROP + CREATE (o retorno mudou) e os privilégios da 1048: só o
//    service_role executa, e ele lê a tabela (a função é INVOKER).
// LIMITE DECLARADO: lê o `.sql`.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1108_cb_ia_uso_por_faixa.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');
const RAIZ = path.join(__dirname, '..', '..');
const ROTA = fs.readFileSync(path.join(RAIZ, 'src/app/api/cb/ia/uso/route.ts'), 'utf8');

const CORPO = CODIGO.match(/CREATE\s+FUNCTION\s+public\.cb_ia_uso[\s\S]*?\$\$;/i)?.[0] ?? '';

describe('1108 — cb_ia_uso por faixa', () => {
  it('o corte do banco é o LIMIAR_DA_FAIXA da tabela de preço', () => {
    const corte = CORPO.match(/\(\s*coalesce\(\s*l\.prompt_tokens\s*,\s*0\s*\)\s*>\s*(\d+)\s*\)\s+AS\s+acima_da_faixa/i)?.[1];
    expect(Number(corte)).toBe(LIMIAR_DA_FAIXA);
  });

  it('a faixa entra no grupo e na ordem total (seis chaves)', () => {
    expect(/GROUP\s+BY\s+1,\s*2,\s*3,\s*5,\s*6,\s*7\s+ORDER\s+BY\s+1,\s*2,\s*3,\s*5,\s*6,\s*7\s*;/i.test(CORPO)).toBe(true);
    // A coluna 7 do SELECT é a faixa (o GROUP BY é posicional).
    const colunas = CORPO.slice(CORPO.indexOf('SELECT'), CORPO.indexOf('FROM ai_usage_log'))
      .split(/,\s*\n/)
      .map((c) => c.trim());
    expect(colunas[6]).toMatch(/AS\s+acima_da_faixa$/i);
  });

  it('a rota pagina pelas seis chaves, a faixa por último', () => {
    const ordem = [...ROTA.matchAll(/\.order\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(ordem).toEqual(['dia', 'modo', 'ia_agente_id', 'provedor', 'modelo', 'acima_da_faixa']);
  });

  it('DROP + CREATE com a mesma assinatura (sem overload sobrando)', () => {
    expect(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s*;/i.test(CODIGO)).toBe(true);
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_ia_uso/i.test(CODIGO)).toBe(false);
    expect(CODIGO.indexOf('DROP FUNCTION')).toBeLessThan(CODIGO.indexOf('CREATE FUNCTION'));
  });

  it('só o service_role executa, e ele lê a tabela (INVOKER)', () => {
    expect(/SECURITY\s+INVOKER/i.test(CORPO)).toBe(true);
    expect(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(CODIGO),
    ).toBe(true);
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s+TO\s+service_role/i.test(CODIGO)).toBe(true);
    expect(/GRANT\s+SELECT\s+ON\s+TABLE\s+ai_usage_log\s+TO\s+service_role/i.test(CODIGO)).toBe(true);
    expect(/GRANT[^;]*cb_ia_uso[^;]*\b(anon|authenticated)\b/i.test(CODIGO)).toBe(false);
  });

  it('a conferência CHAMA a função e compara a soma com o log quando há dado', () => {
    const conferencia = CODIGO.slice(CODIGO.indexOf('DO $$'));
    expect(conferencia).toMatch(/PERFORM\s+1\s+FROM\s+public\.cb_ia_uso\(/i);
    expect(conferencia).toMatch(/RAISE\s+NOTICE\s+'1108: nenhum uso/i);
    expect(conferencia).toMatch(/v_no_log\s*<>\s*v_na_soma/);
  });
});
