// ============================================================
// NOSSO (10/11/2026, `.claude/rules/ia-sandbox.md`): o Playground mostra o
// RESUMO do raciocínio do modelo. Ele só é pedido aos modelos que JÁ
// raciocinam por padrão — neles o pedido muda só o que VOLTA, não o que o
// modelo pensa nem o custo, e o teste continua fiel à produção. Puro: a tela
// usa o mesmo critério para dizer "este modelo não mostra o raciocínio".
// ============================================================

import type { AiProvider } from '../types'

/**
 * Anthropic: a família 5 (Opus, Sonnet, Haiku), Fable e Mythos, em que
 * OMITIR `thinking` já é o raciocínio adaptativo. Neles, `{ type: 'adaptive',
 * display: 'summarized' }` só faz o resumo voltar (o padrão é `omitted`, o
 * bloco vazio). Nos 4.x, omitir é responder SEM raciocinar: pedir mudaria a
 * resposta testada (e o Haiku 4.5 recusaria o `adaptive`). Id fora da forma
 * conhecida = não se pede.
 */
export function anthropicRaciocinaPorPadrao(model: string): boolean {
  const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-\d+)*$/.exec(model)
  if (!m) return false
  return m[1] === 'fable' || m[1] === 'mythos' || Number(m[2]) >= 5
}

/**
 * Gemini: 2.5 em diante, fora os "lite" (nascem sem raciocínio). Neles,
 * `includeThoughts` só faz o resumo voltar; nos outros o campo pode ser
 * recusado — não se pede.
 */
export function geminiRaciocinaPorPadrao(model: string): boolean {
  const m = /^gemini-(\d+(?:\.\d+)?)-/.exec(model)
  return m !== null && Number(m[1]) >= 2.5 && !model.includes('lite')
}

/**
 * O provedor devolve o resumo do raciocínio deste modelo? A OpenAI não: o
 * `/v1/chat/completions` do adaptador não traz o resumo.
 */
export function mostraRaciocinio(provider: AiProvider, model: string): boolean {
  if (provider === 'anthropic') return anthropicRaciocinaPorPadrao(model)
  if (provider === 'gemini') return geminiRaciocinaPorPadrao(model)
  return false
}
