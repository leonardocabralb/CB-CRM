import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { CABECALHO_DE_ORIGEM, ORIGEM_DA_API } from './cliente-da-api';

// ============================================================
// Pino estrutural da ORIGEM `api` (migration 1040).
//
// A marca viaja num cabeçalho que o gatilho da fila do funil lê no banco. Nada
// disso aparece num teste de comportamento sem o PostgREST de verdade, e as
// três formas de quebrar são silenciosas — o aviso `deal.*` só volta a dizer
// `system`:
//   1. `requireApiKey` voltar ao `supabaseAdmin()` compartilhado (sem a marca);
//   2. a marca ir parar num cliente COMPARTILHADO (carimbaria `api` em escrita
//      que não veio da API — o motor de fluxos, os webhooks de entrada);
//   3. o nome ou o valor do cabeçalho divergirem entre o TS e o SQL.
// ============================================================

const raiz = path.join(__dirname, '..', '..', '..', '..');

function ler(relativo: string): string {
  return fs.readFileSync(path.join(raiz, relativo), 'utf8');
}

/** Fonte sem comentários — os arquivos citam os nomes ao EXPLICAR decisões. */
function codigo(relativo: string): string {
  return ler(relativo)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

function arquivos(dir: string): string[] {
  return fs.readdirSync(path.join(raiz, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return arquivos(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

describe('o cliente da API marca a origem', () => {
  it('o cabeçalho é x-cb-origem: api', () => {
    expect(CABECALHO_DE_ORIGEM).toBe('x-cb-origem');
    expect(ORIGEM_DA_API).toBe('api');
    expect(codigo('src/lib/api/v1/cliente-da-api.ts')).toMatch(
      /global:\s*\{\s*headers:\s*\{\s*\[CABECALHO_DE_ORIGEM\]:\s*ORIGEM_DA_API\s*\}\s*\}/
    );
  });

  it('⚠️ o gatilho da 1040 compara com os MESMOS textos', () => {
    const sql = ler('supabase/migrations/1040_cb_origem_api_e_aviso_duravel_do_funil.sql');
    expect(sql).toContain(`->> '${CABECALHO_DE_ORIGEM}'`);
    expect(sql).toContain(`WHEN v_pedido = '${ORIGEM_DA_API}' THEN '${ORIGEM_DA_API}'`);
  });

  it('requireApiKey devolve o cliente da API, nunca o admin compartilhado', () => {
    const fonte = codigo('src/lib/auth/api-context.ts');
    expect(fonte).toMatch(/import\s*\{\s*clienteDaApi\s*\}\s*from\s*'@\/lib\/api\/v1\/cliente-da-api'/);
    expect(fonte).toMatch(/supabase:\s*clienteDaApi\(\)/);
    expect(fonte).not.toContain('admin-client');
    expect(fonte).not.toContain('supabaseAdmin');
  });

  it('⚠️ os clientes COMPARTILHADOS não carregam a marca', () => {
    for (const f of ['src/lib/flows/admin-client.ts', 'src/lib/automations/admin-client.ts']) {
      expect(codigo(f), f).not.toContain('x-cb-origem');
      expect(codigo(f), f).not.toMatch(/global\s*:/);
    }
    // E só UM arquivo do app escreve o cabeçalho.
    const comMarca = arquivos('src').filter((f) => codigo(f).includes("'x-cb-origem'"));
    expect(comMarca).toEqual(['src/lib/api/v1/cliente-da-api.ts']);
  });

  it('⚠️ rota v1 escreve pelo `ctx.supabase`: nenhuma importa um cliente próprio', () => {
    // Um `supabaseAdmin()` ou `createClient` dentro de uma rota v1 moveria card
    // SEM a marca, e o aviso sairia `system`. Rota nova usa o do contexto.
    for (const f of arquivos('src/app/api/v1')) {
      const fonte = codigo(f);
      expect(fonte, f).not.toMatch(/admin-client/);
      expect(fonte, f).not.toMatch(/\bcreateClient\s*\(/);
    }
  });
});
