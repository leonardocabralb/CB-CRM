// ============================================================
// Saída ESTRUTURADA (JSON com esquema) nos três provedores.
//
// Módulo separado de `generate.ts` de propósito: o caminho de resposta
// (draft/auto-reply/playground) continua intocado — quem precisa de JSON
// validado é o Radar de Atendimento, e misturar os dois contratos em
// `generateReply` espalharia o risco de regressão pelo webhook.
//
// Cada provedor tem seu mecanismo nativo:
//   OpenAI    → response_format { type: 'json_schema', strict: true }
//   Anthropic → uma tool obrigatória (tool_choice) cujo input É o resultado
//   Gemini    → generationConfig.responseMimeType + responseSchema
//
// O esquema entra UMA vez, num subconjunto de JSON Schema (`JsonSchema`
// abaixo), e é convertido para o dialeto de cada provedor. Regras do
// subconjunto, cobradas pelo modo estrito do OpenAI:
//   - objetos listam TODAS as propriedades em `required` (opcional se
//     expressa com valor-sentinela: '', [], 'nenhuma' — nunca com campo
//     ausente);
//   - sem uniões de tipo, sem additionalProperties no esquema de entrada
//    (o conversor injeta additionalProperties:false para o OpenAI).
// ============================================================

import { AiError, type AiConfig, type AiUsage } from './types'
import { aiRequestTimeoutMs } from './defaults'
import {
  normalizeUsage,
  providerHttpError,
  toNetworkError,
} from './providers/shared'
import { OPENAI_URL } from './providers/openai'
import { ANTHROPIC_URL, ANTHROPIC_VERSION } from './providers/anthropic'
import {
  geminiEndpoint,
  geminiText,
  geminiUsage,
  type GeminiResponse,
} from './providers/gemini'

/** Subconjunto de JSON Schema que os três dialetos sabem expressar. */
export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'integer' | 'number' | 'boolean'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: string[]
}

export interface StructuredArgs {
  config: AiConfig
  systemPrompt: string
  /** O conteúdo a analisar — vai como o único turno `user`. */
  userContent: string
  /** Esquema do objeto esperado. A raiz TEM de ser `object`. */
  schema: JsonSchema
  maxOutputTokens: number
}

export interface StructuredResult {
  /** O objeto já parseado. Valide a FORMA no chamador (o esquema garante
   *  sintaxe, não semântica). */
  object: unknown
  usage: AiUsage | null
}

/** additionalProperties:false em todo objeto — exigência do strict do OpenAI. */
function fecharObjetos(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { ...schema }
  if (schema.type === 'object') {
    out.additionalProperties = false
    if (schema.properties) {
      out.properties = Object.fromEntries(
        Object.entries(schema.properties).map(([k, v]) => [k, fecharObjetos(v)]),
      )
    }
  }
  if (schema.items) out.items = fecharObjetos(schema.items)
  return out
}

/**
 * Dialeto do Gemini: OpenAPI-like, com `type` em MAIÚSCULAS e sem
 * additionalProperties. Conferido contra a doc REST (ai.google.dev) em
 * 2026-08 — `"type": "OBJECT"`, `properties`, `required`, `items`, `enum`.
 */
export function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  const out: Record<string, unknown> = { type: schema.type.toUpperCase() }
  if (schema.description) out.description = schema.description
  if (schema.enum) out.enum = schema.enum
  if (schema.required) out.required = schema.required
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    )
  }
  if (schema.items) out.items = toGeminiSchema(schema.items)
  return out
}

function parseJsonOuErro(raw: string, provider: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    throw new AiError(`${provider} returned invalid JSON for a structured request.`, {
      code: 'invalid_json',
    })
  }
}

/**
 * Gera um objeto JSON validado pelo provedor configurado na conta.
 * Lança `AiError` em qualquer falha (rede, chave, JSON inválido) — o
 * chamador decide retentar (o worker do Radar retenta via `tentativas`).
 */
export async function generateStructured(
  args: StructuredArgs,
): Promise<StructuredResult> {
  const { config } = args
  switch (config.provider) {
    case 'openai':
      return structuredOpenAi(args)
    case 'anthropic':
      return structuredAnthropic(args)
    case 'gemini':
      return structuredGemini(args)
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }
}

async function structuredOpenAi(args: StructuredArgs): Promise<StructuredResult> {
  const { config, systemPrompt, userContent, schema, maxOutputTokens } = args
  let res: Response
  try {
    res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'resultado', strict: true, schema: fecharObjetos(schema) },
        },
        max_completion_tokens: maxOutputTokens,
      }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('OpenAI', res)

  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  } | null
  const raw = data?.choices?.[0]?.message?.content
  if (!raw || !raw.trim()) {
    throw new AiError('OpenAI returned an empty structured response.', {
      code: 'empty_response',
    })
  }
  return {
    object: parseJsonOuErro(raw, 'OpenAI'),
    usage: normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    }),
  }
}

async function structuredAnthropic(args: StructuredArgs): Promise<StructuredResult> {
  const { config, systemPrompt, userContent, schema, maxOutputTokens } = args
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        system: systemPrompt,
        max_tokens: maxOutputTokens,
        // A tool é o mecanismo de esquema: com tool_choice obrigando a
        // chamada, o `input` do tool_use já vem como objeto validado.
        tools: [
          {
            name: 'registrar_resultado',
            description: 'Registra o resultado estruturado da análise.',
            input_schema: schema,
          },
        ],
        tool_choice: { type: 'tool', name: 'registrar_resultado' },
        messages: [{ role: 'user', content: userContent }],
      }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Anthropic', res)

  const data = (await res.json().catch(() => null)) as {
    content?: { type?: string; input?: unknown }[]
    usage?: { input_tokens?: number; output_tokens?: number }
  } | null
  const toolUse = data?.content?.find((b) => b.type === 'tool_use')
  if (!toolUse || toolUse.input === undefined || toolUse.input === null) {
    throw new AiError('Anthropic returned no structured tool call.', {
      code: 'empty_response',
    })
  }
  return {
    object: toolUse.input,
    usage: normalizeUsage({
      prompt: data?.usage?.input_tokens,
      completion: data?.usage?.output_tokens,
    }),
  }
}

async function structuredGemini(args: StructuredArgs): Promise<StructuredResult> {
  const { config, systemPrompt, userContent, schema, maxOutputTokens } = args
  let res: Response
  try {
    res = await fetch(geminiEndpoint(config.model), {
      method: 'POST',
      headers: {
        'x-goog-api-key': config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userContent }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: toGeminiSchema(schema),
          maxOutputTokens,
        },
      }),
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    })
  } catch (err) {
    throw toNetworkError(err)
  }
  if (!res.ok) throw await providerHttpError('Gemini', res)

  const data = (await res.json().catch(() => null)) as GeminiResponse | null
  const raw = geminiText(data)
  if (!raw) {
    throw new AiError('Gemini returned an empty structured response.', {
      code: 'empty_response',
    })
  }
  return { object: parseJsonOuErro(raw, 'Gemini'), usage: geminiUsage(data) }
}
