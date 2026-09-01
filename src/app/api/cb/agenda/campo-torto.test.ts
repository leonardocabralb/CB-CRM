import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// M19 do plano 31/08 — campo PRESENTE e torto não pode virar `null` com 200.
//
// O PATCH da reunião já tratava `owner_user_id` e `contact_id` assim (400
// quando vêm preenchidos e inválidos). O `channel_id` ficou para trás com
// `typeof valor === 'string' && UUID.test(valor) ? valor : null`, que
// traduz LIXO em DESVINCULAR e responde 200 — um integrador que mande o id
// errado pela API perde o canal da reunião e recebe "deu certo".
//
// ⚠️ `null` EXPLÍCITO continua desvinculando: é gesto legítimo do operador
// ("esta reunião não é de canal nenhum"), e confundir os dois casos
// quebraria a tela em vez de proteger o dado. É essa distinção que o teste
// fixa — não basta "existe um 400 no arquivo".
// ============================================================

const fonte = fs
  .readFileSync(path.join(__dirname, '[id]', 'route.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/.*$/gm, '');

/** O corpo do ramo `channel_id` do laço de campos editáveis. */
function ramoDoCanal(): string {
  const i = fonte.indexOf("campo === 'channel_id'");
  expect(i, 'ramo do channel_id não encontrado').toBeGreaterThan(-1);
  const j = fonte.indexOf("campo === 'titulo'", i);
  return fonte.slice(i, j > i ? j : i + 600);
}

describe('PATCH da reunião: channel_id torto (M19)', () => {
  it('id inválido devolve 400, não desvincula em silêncio', () => {
    const ramo = ramoDoCanal();
    expect(ramo).toContain('status: 400');
    // A forma antiga, que é a regressão exata: ternário caindo em null.
    expect(ramo).not.toMatch(/UUID\.test\(valor\)\s*\?\s*valor\s*:\s*null/);
  });

  it('`null` explícito continua desvinculando', () => {
    expect(ramoDoCanal()).toMatch(/valor === null/);
  });

  it('a mesma régua já valia para os outros dois campos de referência', () => {
    // Se algum merge afrouxar estes, o `channel_id` fica sozinho na regra
    // certa e a rota volta a ser incoerente consigo mesma.
    expect(fonte).toContain("{ error: 'Cliente inválido.' }");
    expect(fonte).toContain('status: 400');
  });
});
