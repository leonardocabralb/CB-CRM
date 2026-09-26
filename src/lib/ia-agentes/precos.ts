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
// ============================================================

import type { AiProvider } from '@/lib/ai/types'

export interface LinhaDePreco {
  provedor: AiProvider
  modelo: string
  /** Primeiro dia (YYYY-MM-DD) em que vale; `null` = desde sempre. */
  desde: string | null
  /** US$ por 1M de tokens. */
  entrada: number
  saida: number
  fonte: string
}

// Conferido em 25/09/2026.
export const PRECOS: readonly LinhaDePreco[] = [
  { provedor: 'gemini', modelo: 'gemini-3.7-flash', desde: null, entrada: 0.75, saida: 3.75, fonte: 'ai.google.dev/gemini-api/docs/pricing (preço introdutório até 31/12/2026)' },
  { provedor: 'gemini', modelo: 'gemini-3.7-flash', desde: '2027-01-01', entrada: 1.5, saida: 7.5, fonte: 'ai.google.dev/gemini-api/docs/pricing (a partir de 01/01/2027)' },
  { provedor: 'gemini', modelo: 'gemini-3.6-flash', desde: null, entrada: 0.75, saida: 3.75, fonte: 'cloud.google.com, Agent Platform pricing (até 31/12/2026)' },
  { provedor: 'gemini', modelo: 'gemini-3.6-flash', desde: '2027-01-01', entrada: 1.5, saida: 7.5, fonte: 'cloud.google.com, Agent Platform pricing (a partir de 01/01/2027)' },
  { provedor: 'openai', modelo: 'gpt-5.4', desde: null, entrada: 2.5, saida: 15, fonte: 'azure.microsoft.com/pricing/details/azure-openai (GPT-5.4, global; e inworld.ai, que repassa o preço da OpenAI)' },
  { provedor: 'openai', modelo: 'gpt-5.4-mini', desde: null, entrada: 0.75, saida: 4.5, fonte: 'openai.com/index/introducing-gpt-5-4-mini-and-nano' },
  { provedor: 'openai', modelo: 'gpt-5.4-nano', desde: null, entrada: 0.2, saida: 1.25, fonte: 'openai.com/index/introducing-gpt-5-4-mini-and-nano' },
  { provedor: 'anthropic', modelo: 'claude-haiku-4-5-20251001', desde: null, entrada: 1, saida: 5, fonte: 'anthropic.com/claude/haiku' },
  { provedor: 'anthropic', modelo: 'claude-sonnet-5', desde: null, entrada: 2, saida: 10, fonte: 'platform.claude.com/docs/en/models/overview' },
]

/** O preço vigente no DIA (YYYY-MM-DD) — a linha mais recente cujo `desde` já chegou. */
export function precoNoDia(
  provedor: string,
  modelo: string,
  dia: string,
): LinhaDePreco | null {
  let melhor: LinhaDePreco | null = null
  for (const p of PRECOS) {
    if (p.provedor !== provedor || p.modelo !== modelo) continue
    if (p.desde !== null && p.desde > dia) continue
    if (!melhor || (p.desde ?? '') > (melhor.desde ?? '')) melhor = p
  }
  return melhor
}

/** Custo em US$ de um conjunto de chamadas; `null` = modelo sem preço. */
export function custoEmDolar(args: {
  provedor: string
  modelo: string
  dia: string
  tokensEntrada: number
  tokensSaida: number
  tokensTotal: number
}): number | null {
  const preco = precoNoDia(args.provedor, args.modelo, args.dia)
  if (!preco) return null
  const saidaCobrada = Math.max(args.tokensSaida, args.tokensTotal - args.tokensEntrada, 0)
  return (args.tokensEntrada * preco.entrada + saidaCobrada * preco.saida) / 1_000_000
}

/** US$ → R$; `null` sem cotação ou sem custo. */
export function emReais(dolar: number | null, cotacao: number | null): number | null {
  if (dolar === null || cotacao === null || !(cotacao > 0)) return null
  return dolar * cotacao
}
