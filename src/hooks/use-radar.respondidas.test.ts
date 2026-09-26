import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// ============================================================
// A conferência AO VIVO do painel do Radar (`respostasDepoisDaPendencia`):
// quem fecha a pendência do cliente. D11 do docs/PLANO-agentes-de-ia.md — a
// resposta do AGENTE DE IA (`bot` com `ia_agente_id`) passa a fechar, como a
// de gente; robô de fluxo, automação e disparo continuam de fora.
//
// Pino no FONTE, como o `use-radar.resgate.test.ts`: o hook não tem stub de
// PostgREST, e o modo de falha é silencioso. Para não pinar só o TEXTO, o
// teste avalia o filtro contra linhas de exemplo com um intérprete mínimo da
// gramática que ele usa (`and(col.op.valor, …)` separados por vírgula) —
// errar o operador (`is.not.null`, `eq.true`) faz a avaliação reprovar.
// ============================================================

const cru = fs.readFileSync(path.join(__dirname, 'use-radar.ts'), 'utf8');
const fonte = cru.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** O valor da constante, juntando os literais concatenados. */
function lerFiltro(): string {
  const i = fonte.indexOf('const RESPOSTA_QUE_FECHA_A_PENDENCIA =');
  expect(i).toBeGreaterThan(-1);
  const corpo = fonte.slice(i, fonte.indexOf(';', i));
  return [...corpo.matchAll(/'([^']*)'/g)].map((m) => m[1]).join('');
}

type Linha = Record<string, string | boolean | null>;

/** Intérprete mínimo: OU entre os `and(...)`, E dentro de cada um. */
function casa(filtro: string, linha: Linha): boolean {
  const ramos = [...filtro.matchAll(/and\(([^)]*)\)/g)].map((m) => m[1]);
  // Tudo o que está no filtro tem de estar num `and(...)` — senão o
  // intérprete ignoraria um pedaço e o teste passaria sobre filtro torto.
  expect(ramos.map((r) => `and(${r})`).join(',')).toBe(filtro);
  return ramos.some((ramo) =>
    ramo.split(',').every((cond) => {
      const [col, ...resto] = cond.split('.');
      const op = resto.join('.');
      const v = linha[col];
      if (op === 'not.is.null') return v !== null && v !== undefined;
      if (op === 'is.true') return v === true;
      if (op.startsWith('eq.')) return v === op.slice(3);
      throw new Error(`operador desconhecido no filtro: ${cond}`);
    }),
  );
}

const base: Linha = {
  sender_type: 'agent',
  sender_id: null,
  from_device: false,
  ia_agente_id: null,
};

describe('use-radar: quem fecha a pendência na conferência ao vivo (D11)', () => {
  const filtro = lerFiltro();

  it('a resposta do AGENTE DE IA fecha', () => {
    expect(casa(filtro, { ...base, sender_type: 'bot', ia_agente_id: 'agente-1' })).toBe(true);
  });

  it('⚠️ robô SEM `ia_agente_id` (fluxo, automação) NÃO fecha', () => {
    expect(casa(filtro, { ...base, sender_type: 'bot' })).toBe(false);
  });

  it('gente continua fechando: `sender_id` ou celular pareado', () => {
    expect(casa(filtro, { ...base, sender_id: 'u1' })).toBe(true);
    expect(casa(filtro, { ...base, from_device: true })).toBe(true);
  });

  it('saída da equipe sem gente atrás (disparo, automação) NÃO fecha', () => {
    expect(casa(filtro, base)).toBe(false);
  });

  it('mensagem do CLIENTE nunca fecha, mesmo com colunas preenchidas por engano', () => {
    expect(
      casa(filtro, { ...base, sender_type: 'customer', sender_id: 'u1', from_device: true }),
    ).toBe(false);
    expect(casa(filtro, { ...base, sender_type: 'customer', ia_agente_id: 'agente-1' })).toBe(
      false,
    );
  });

  it('`ia_agente_id` só vale no `bot` — o predicado do ramo "respondido" da 1044', () => {
    expect(casa(filtro, { ...base, ia_agente_id: 'agente-1' })).toBe(false);
  });
});

describe('use-radar: a consulta usa o filtro, sem um `.eq` que corte a IA', () => {
  const inicio = fonte.indexOf('async function respostasDepoisDaPendencia');
  const fim = fonte.indexOf('export function useRadar', inicio);
  const corpo = fonte.slice(inicio, fim);

  it('a consulta a `messages` passa por `RESPOSTA_QUE_FECHA_A_PENDENCIA`', () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(corpo).toContain('.or(RESPOSTA_QUE_FECHA_A_PENDENCIA)');
  });

  it("⚠️ não sobra `.eq('sender_type', …)` — a resposta da IA é `bot` e sumiria", () => {
    expect(corpo).not.toMatch(/\.eq\(\s*'sender_type'/);
  });

  it('a exclusão da AGENDADA continua (ela sai como `agent` COM `sender_id`)', () => {
    expect(corpo).toContain(".from('cb_scheduled_messages')");
    expect(corpo).toContain('if (deAgendada.has(m.id)) continue;');
  });
});
