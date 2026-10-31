// ============================================================
// Custo da IA em R$ (D21 do docs/PLANO-agentes-de-ia.md). PURO, testado.
//
// Tabela de preço de LISTA em US$ por milhão de tokens, com a fonte e a
// VIGÊNCIA de cada linha: preço muda (o Gemini Flash dobra em 01/01/2027), e a
// mudança entra como linha nova, para o histórico não ser recalculado com o
// preço de hoje. Convertida pela cotação que o administrador informa.
//
// ⚠️ É ESTIMATIVA, não fatura: sem cache, sem lote, sem o preço de áudio
// separado. Modelo fora da tabela é "sem preço" (null), NUNCA zero — zero
// afirmaria que a chamada saiu de graça.
//
// ⚠️ O Gemini com raciocínio conta os "pensamentos" no total mas não na saída
// (`providers/gemini.ts`), e cobra os pensamentos como saída: a saída cobrada
// é `max(saída, total − entrada)`, senão o custo sai menor.
//
// ⚠️⚠️ FAIXA pelo tamanho de CADA pedido (1108, 25/10/2026): o Haiku 5.5 tem
// duas tabelas — o pedido com até 100 mil tokens de entrada paga uma, o
// maior paga outra (entrada E saída). A soma do dia (`cb_ia_uso`) separa as
// duas faixas (`acima_da_faixa`, `prompt_tokens > 100000` de cada linha de
// `ai_usage_log`, que é UMA chamada). Sem a faixa (a soma de antes da 1108),
// o modelo com faixa é "sem preço" — com a tabela baixa, o PDF longo da
// leitura sairia 5× mais barato.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'

/**
 * O corte da faixa: entrada do PEDIDO acima disto. ⚠️ É o MESMO número da
 * 1108 (`l.prompt_tokens > 100000` em `cb_ia_uso`), cobrado por
 * `precos.test.ts` lendo o `.sql`: o banco só sabe separar neste corte.
 */
export const LIMIAR_DA_FAIXA = 100_000

export interface LinhaDePreco {
  provedor: AiProvider
  modelo: string
  /** Primeiro dia (YYYY-MM-DD) em que vale; `null` = desde sempre. */
  desde: string | null
  /** US$ por 1M de tokens. */
  entrada: number
  saida: number
  /**
   * Só nos modelos com DUAS tabelas: a linha vale para o pedido com MAIS de
   * `LIMIAR_DA_FAIXA` tokens de entrada. Ausente = a linha vale até o limiar
   * (e, no modelo sem faixa, para todo pedido).
   */
  acimaDe?: typeof LIMIAR_DA_FAIXA
  fonte: string
}

// Conferido em 25/09/2026.
export const PRECOS: readonly LinhaDePreco[] = [
  { provedor: 'gemini', modelo: 'gemini-3.7-flash', desde: null, entrada: 0.75, saida: 3.75, fonte: 'ai.google.dev/gemini-api/docs/pricing (preço introdutório até 31/12/2026)' },
  { provedor: 'gemini', modelo: 'gemini-3.7-flash', desde: '2027-01-01', entrada: 1.5, saida: 7.5, fonte: 'ai.google.dev/gemini-api/docs/pricing (a partir de 01/01/2027)' },
  { provedor: 'gemini', modelo: 'gemini-3.8-flash', desde: null, entrada: 0.75, saida: 3.75, fonte: 'ai.google.dev/gemini-api/docs/pricing (25/10/2026; preço introdutório até 31/12/2026)' },
  { provedor: 'gemini', modelo: 'gemini-3.8-flash', desde: '2027-01-01', entrada: 1.5, saida: 7.5, fonte: 'ai.google.dev/gemini-api/docs/pricing (25/10/2026; a partir de 01/01/2027)' },
  { provedor: 'gemini', modelo: 'gemini-3.6-flash', desde: null, entrada: 0.75, saida: 3.75, fonte: 'cloud.google.com, Agent Platform pricing (até 31/12/2026)' },
  { provedor: 'gemini', modelo: 'gemini-3.6-flash', desde: '2027-01-01', entrada: 1.5, saida: 7.5, fonte: 'cloud.google.com, Agent Platform pricing (a partir de 01/01/2027)' },
  // Conferido em 26/09/2026 (ai.google.dev/gemini-api/docs/pricing): os outros três que a tela sugere.
  { provedor: 'gemini', modelo: 'gemini-3.5-flash', desde: null, entrada: 1.5, saida: 9, fonte: 'ai.google.dev/gemini-api/docs/pricing' },
  { provedor: 'gemini', modelo: 'gemini-3.5-flash-lite', desde: null, entrada: 0.3, saida: 2.5, fonte: 'ai.google.dev/gemini-api/docs/pricing' },
  { provedor: 'gemini', modelo: 'gemini-3.1-flash-lite', desde: null, entrada: 0.25, saida: 1.5, fonte: 'ai.google.dev/gemini-api/docs/pricing (texto; áudio 0,50)' },
  { provedor: 'openai', modelo: 'gpt-5.4', desde: null, entrada: 2.5, saida: 15, fonte: 'azure.microsoft.com/pricing/details/azure-openai (GPT-5.4, global; e inworld.ai, que repassa o preço da OpenAI)' },
  { provedor: 'openai', modelo: 'gpt-5.4-mini', desde: null, entrada: 0.75, saida: 4.5, fonte: 'openai.com/index/introducing-gpt-5-4-mini-and-nano' },
  { provedor: 'openai', modelo: 'gpt-5.4-nano', desde: null, entrada: 0.2, saida: 1.25, fonte: 'openai.com/index/introducing-gpt-5-4-mini-and-nano' },
  { provedor: 'anthropic', modelo: 'claude-haiku-4-5-20251001', desde: null, entrada: 1, saida: 5, fonte: 'anthropic.com/claude/haiku' },
  // Conferido em 25/10/2026 (platform.claude.com/docs/en/about-claude/pricing):
  // a família 5.5. O Haiku tem as DUAS faixas (o cabeçalho); Sonnet e Opus,
  // uma tabela só.
  { provedor: 'anthropic', modelo: 'claude-haiku-5-5', desde: null, entrada: 0.1, saida: 0.5, fonte: 'platform.claude.com/docs/en/about-claude/pricing (25/10/2026; pedido até 100 mil tokens de entrada)' },
  { provedor: 'anthropic', modelo: 'claude-haiku-5-5', desde: null, acimaDe: LIMIAR_DA_FAIXA, entrada: 0.5, saida: 2.5, fonte: 'platform.claude.com/docs/en/about-claude/pricing (25/10/2026; pedido acima de 100 mil tokens de entrada)' },
  { provedor: 'anthropic', modelo: 'claude-sonnet-5-5', desde: null, entrada: 2, saida: 10, fonte: 'platform.claude.com/docs/en/about-claude/pricing (25/10/2026)' },
  { provedor: 'anthropic', modelo: 'claude-opus-5-5', desde: null, entrada: 4, saida: 20, fonte: 'platform.claude.com/docs/en/about-claude/pricing (25/10/2026)' },
  { provedor: 'anthropic', modelo: 'claude-sonnet-5', desde: null, entrada: 2, saida: 10, fonte: 'platform.claude.com/docs/en/models/overview' },
  { provedor: 'anthropic', modelo: 'claude-sonnet-4-5-20250929', desde: null, entrada: 3, saida: 15, fonte: 'platform.claude.com/docs/en/about-claude/pricing (26/09/2026)' },
]

/**
 * O preço vigente no DIA (YYYY-MM-DD) — a linha mais recente cujo `desde` já
 * chegou — na FAIXA pedida. `acima` num modelo sem faixa = a linha dele (uma
 * tabela vale para todo pedido). Sem `faixa`, a de até o limiar.
 */
export function precoNoDia(
  provedor: string,
  modelo: string,
  dia: string,
  faixa: 'ate' | 'acima' = 'ate',
): LinhaDePreco | null {
  const naFaixa = (alta: boolean) => {
    let melhor: LinhaDePreco | null = null
    for (const p of PRECOS) {
      if (p.provedor !== provedor || p.modelo !== modelo) continue
      if ((p.acimaDe !== undefined) !== alta) continue
      if (p.desde !== null && p.desde > dia) continue
      if (!melhor || (p.desde ?? '') > (melhor.desde ?? '')) melhor = p
    }
    return melhor
  }
  return faixa === 'acima' ? (naFaixa(true) ?? naFaixa(false)) : naFaixa(false)
}

/** O modelo tem DUAS tabelas pelo tamanho do pedido no dia? */
export function temFaixa(provedor: string, modelo: string, dia: string): boolean {
  return PRECOS.some(
    (p) =>
      p.provedor === provedor &&
      p.modelo === modelo &&
      p.acimaDe !== undefined &&
      (p.desde === null || p.desde <= dia),
  )
}

/**
 * Custo em US$ de um conjunto de chamadas; `null` = sem preço.
 *
 * `acimaDaFaixa`: as chamadas são de pedidos com mais de `LIMIAR_DA_FAIXA`
 * tokens de entrada (a coluna da 1108). `null` = a soma não disse (a função de
 * antes da 1108): o modelo COM faixa fica sem preço — nunca a tabela baixa por
 * palpite; o sem faixa não depende dela.
 */
export function custoEmDolar(args: {
  provedor: string
  modelo: string
  dia: string
  acimaDaFaixa: boolean | null
  tokensEntrada: number
  tokensSaida: number
  tokensTotal: number
}): number | null {
  const comFaixa = temFaixa(args.provedor, args.modelo, args.dia)
  if (comFaixa && args.acimaDaFaixa === null) return null
  const preco = precoNoDia(args.provedor, args.modelo, args.dia, args.acimaDaFaixa === true ? 'acima' : 'ate')
  if (!preco) return null
  const saidaCobrada = Math.max(args.tokensSaida, args.tokensTotal - args.tokensEntrada, 0)
  return (args.tokensEntrada * preco.entrada + saidaCobrada * preco.saida) / 1_000_000
}

/** US$ → R$; `null` sem cotação ou sem custo. */
export function emReais(dolar: number | null, cotacao: number | null): number | null {
  if (dolar === null || cotacao === null || !(cotacao > 0)) return null
  return dolar * cotacao
}
