import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { comecarNoCliente } from './comeca-no-cliente'
import {
  normalizeUsage,
  providerHttpError,
  respostaCortada,
  toNetworkError,
  type ProviderArgs,
} from './shared'

// A chave viaja SEMPRE no header `x-goog-api-key`, nunca em `?key=` na URL:
// URL vaza em log de proxy/erro; header não.
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

export interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
    /** O que veio do cache IMPLÍCITO (já contado em `promptTokenCount`), cobrado a 10% da entrada. */
    cachedContentTokenCount?: number
  }
}

export function geminiEndpoint(model: string): string {
  return `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`
}

/**
 * Nosso `ChatMessage[]` no formato `contents` do Gemini: `user` fica `user`,
 * `assistant` vira `model`. Mesma normalização do adapter Anthropic
 * (`comecarNoCliente`): turnos consecutivos fundidos e a conversa começando no
 * cliente, com as mensagens do escritório que vieram antes MANTIDAS atrás de
 * uma nota — o Gemini também espera a conversa começando em quem pergunta.
 */
export function toGeminiContents(
  messages: ChatMessage[],
): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const merged = comecarNoCliente(messages)
  return merged.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }))
}

/** Junta o texto de todas as parts do primeiro candidato (pode vir fatiado). */
export function geminiText(data: GeminiResponse | null): string {
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('')
      .trim() ?? ''
  )
}

/**
 * O uso de uma chamada. O Gemini faz cache SOZINHO (implícito, a partir de
 * 4.096 tokens iguais no começo do pedido, 09/11/2026): o que veio dele já
 * está em `promptTokenCount` e sai também em `cacheReadTokens`, para o custo
 * cobrar 10% dessa parte (`precos.ts`). Não há gravação a pagar.
 */
export function geminiUsage(data: GeminiResponse | null) {
  return normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
    cacheRead: data?.usageMetadata?.cachedContentTokenCount,
  })
}

/**
 * Call Gemini's generateContent endpoint with the caller's own key.
 * Returns the raw model text + token usage (handoff parsing happens in
 * `generateReply`), same contract as the OpenAI/Anthropic adapters.
 */
export async function generateGemini(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(geminiEndpoint(model), {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: toGeminiContents(messages),
        generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Gemini', res)
  }

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  // Antes do texto: com o teto batido, o que veio é a resposta pela metade
  // (ou nada, quando o raciocínio gastou tudo).
  if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
    throw respostaCortada('Gemini')
  }
  const text = geminiText(data)
  if (!text) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { text, usage: geminiUsage(data) }
}
