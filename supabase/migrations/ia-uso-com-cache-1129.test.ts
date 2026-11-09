import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { LIMIAR_DA_FAIXA } from '../../src/lib/ia-agentes/precos';

// ============================================================
// 1129 — o uso de IA guarda o CACHE do provedor; `cb_ia_uso` soma as duas
// partes. É a definição VIGENTE da função: os pinos da 1108 (faixa, ordem
// total, privilégios) valem aqui também. O que este pino segura:
//
// 1. As colunas `cache_leitura_tokens`/`cache_escrita_tokens` nascem em
//    `ai_usage_log` (aditiva, ANTES do deploy) e são as que `logAiUsage` grava.
// 2. A função devolve as somas `tokens_cache_leitura`/`tokens_cache_escrita`
//    com os nomes que `lerLinhaDeUso` lê.
// 3. O corte da faixa e as seis chaves da 1108 não mudaram.
// 4. DROP + CREATE e os privilégios da 1108.
// LIMITE DECLARADO: lê o `.sql` e o fonte.
// ============================================================

const SQL = fs.readFileSync(path.join(__dirname, '1129_cb_ia_uso_com_cache.sql'), 'utf8');
const CODIGO = SQL.replace(/--.*$/gm, '');
const RAIZ = path.join(__dirname, '..', '..');
const ROTA = fs.readFileSync(path.join(RAIZ, 'src/app/api/cb/ia/uso/route.ts'), 'utf8');
const LOG = fs.readFileSync(path.join(RAIZ, 'src/lib/ai/usage.ts'), 'utf8');
const USO = fs.readFileSync(path.join(RAIZ, 'src/lib/ia-agentes/uso.ts'), 'utf8');

const CORPO = CODIGO.match(/CREATE\s+FUNCTION\s+public\.cb_ia_uso[\s\S]*?\$\$;/i)?.[0] ?? '';

describe('1129 — o uso de IA com o cache do provedor', () => {
  it('as colunas nascem em ai_usage_log, nulas e sem DEFAULT (só catálogo), e o log grava as MESMAS', () => {
    for (const coluna of ['cache_leitura_tokens', 'cache_escrita_tokens']) {
      expect(new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${coluna}\\s+integer\\s*[,;]`, 'i').test(CODIGO)).toBe(true);
      expect(LOG).toContain(`${coluna}:`);
    }
  });

  it('a função soma as duas, com os nomes que `lerLinhaDeUso` lê', () => {
    for (const [coluna, soma] of [
      ['cache_leitura_tokens', 'tokens_cache_leitura'],
      ['cache_escrita_tokens', 'tokens_cache_escrita'],
    ]) {
      expect(new RegExp(`coalesce\\(sum\\(l\\.${coluna}\\),\\s*0\\)::bigint\\s+AS\\s+${soma}`, 'i').test(CORPO)).toBe(true);
      expect(new RegExp(`${soma}\\s+bigint`, 'i').test(CORPO)).toBe(true);
      expect(USO).toContain(`r.${soma}`);
    }
  });

  it('o corte do banco continua o LIMIAR_DA_FAIXA da tabela de preço', () => {
    const corte = CORPO.match(/\(\s*coalesce\(\s*l\.prompt_tokens\s*,\s*0\s*\)\s*>\s*(\d+)\s*\)\s+AS\s+acima_da_faixa/i)?.[1];
    expect(Number(corte)).toBe(LIMIAR_DA_FAIXA);
  });

  it('a faixa continua no grupo e na ordem total (seis chaves), e a rota pagina por elas', () => {
    expect(/GROUP\s+BY\s+1,\s*2,\s*3,\s*5,\s*6,\s*7\s+ORDER\s+BY\s+1,\s*2,\s*3,\s*5,\s*6,\s*7\s*;/i.test(CORPO)).toBe(true);
    const colunas = CORPO.slice(CORPO.indexOf('SELECT'), CORPO.indexOf('FROM ai_usage_log'))
      .split(/,\s*\n/)
      .map((c) => c.trim());
    expect(colunas[6]).toMatch(/AS\s+acima_da_faixa$/i);
    const ordem = [...ROTA.matchAll(/\.order\('([a-z_]+)'/g)].map((m) => m[1]);
    expect(ordem).toEqual(['dia', 'modo', 'ia_agente_id', 'provedor', 'modelo', 'acima_da_faixa']);
  });

  it('DROP + CREATE com a mesma assinatura, e só o service_role executa (INVOKER)', () => {
    expect(/DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s*;/i.test(CODIGO)).toBe(true);
    expect(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.cb_ia_uso/i.test(CODIGO)).toBe(false);
    expect(CODIGO.indexOf('DROP FUNCTION')).toBeLessThan(CODIGO.indexOf('CREATE FUNCTION'));
    expect(/SECURITY\s+INVOKER/i.test(CORPO)).toBe(true);
    expect(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(CODIGO),
    ).toBe(true);
    expect(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.cb_ia_uso\(uuid,\s*timestamptz,\s*text\)\s+TO\s+service_role/i.test(CODIGO)).toBe(true);
    expect(/GRANT\s+SELECT\s+ON\s+TABLE\s+ai_usage_log\s+TO\s+service_role/i.test(CODIGO)).toBe(true);
    expect(/GRANT[^;]*cb_ia_uso[^;]*\b(anon|authenticated)\b/i.test(CODIGO)).toBe(false);
  });

  it('a conferência confere as colunas, CHAMA a função e compara a soma com o log quando há dado', () => {
    const conferencia = CODIGO.slice(CODIGO.indexOf('DO $$'));
    expect(conferencia).toMatch(/cache_leitura_tokens/);
    expect(conferencia).toMatch(/PERFORM\s+1\s+FROM\s+public\.cb_ia_uso\(/i);
    expect(conferencia).toMatch(/RAISE\s+NOTICE\s+'1129: nenhum uso/i);
    expect(conferencia).toMatch(/v_no_log\s*<>\s*v_na_soma/);
  });
});
