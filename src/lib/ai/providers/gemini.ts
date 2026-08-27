import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
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
  }
}

export function geminiEndpoint(model: string): string {
  return `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`
}

/**
 * Nosso `ChatMessage[]` no formato `contents` do Gemini: `user` fica `user`,
 * `assistant` vira `model`. Mesma normalização do adapter Anthropic — turnos
 * consecutivos fundidos e sem turno inicial do assistente — porque o Gemini
 * também espera a conversa começando em quem pergunta.
 */
export function toGeminiContents(
  messages: ChatMessage[],
): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    merged.push({ role: 'user', content: '(The customer has not sent a message yet.)' })
  }
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

export function geminiUsage(data: GeminiResponse | null) {
  return normalizeUsage({
    prompt: data?.usageMetadata?.promptTokenCount,
    completion: data?.usageMetadata?.candidatesTokenCount,
    total: data?.usageMetadata?.totalTokenCount,
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
  const text = geminiText(data)
  if (!text) {
    throw new AiError('Gemini returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { text, usage: geminiUsage(data) }
}
