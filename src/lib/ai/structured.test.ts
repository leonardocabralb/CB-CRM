import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateStructured, toGeminiSchema, type JsonSchema } from './structured'
import type { AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'gemini',
    model: 'gemini-test',
    apiKey: 'key-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    nota: { type: 'integer', description: '0 a 10' },
    sinais: { type: 'array', items: { type: 'string' } },
    urgencia: { type: 'string', enum: ['nenhuma', 'alta'] },
  },
  required: ['nota', 'sinais', 'urgencia'],
}

function okResponse(json: unknown): Response {
  return { ok: true, status: 200, json: async () => json } as unknown as Response
}
function errResponse(status: number, json: unknown): Response {
  return { ok: false, status, json: async () => json } as unknown as Response
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => vi.unstubAllGlobals())

function args(overrides: Partial<AiConfig> = {}) {
  return {
    config: config(overrides),
    systemPrompt: 'sys',
    userContent: 'conversa',
    schema: SCHEMA,
    maxOutputTokens: 512,
  }
}

describe('toGeminiSchema', () => {
  it('converte para o dialeto OpenAPI com tipos em maiúsculas', () => {
    expect(toGeminiSchema(SCHEMA)).toEqual({
      type: 'OBJECT',
      required: ['nota', 'sinais', 'urgencia'],
      properties: {
        nota: { type: 'INTEGER', description: '0 a 10' },
        sinais: { type: 'ARRAY', items: { type: 'STRING' } },
        urgencia: { type: 'STRING', enum: ['nenhuma', 'alta'] },
      },
    })
  })
})

describe('generateStructured — Gemini', () => {
  it('chama generateContent com responseSchema e parseia o JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        candidates: [
          { content: { parts: [{ text: '{"nota":7,"sinais":[],"urgencia":"nenhuma"}' }] } },
        ],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateStructured(args())
    expect(res.object).toEqual({ nota: 7, sinais: [], urgencia: 'nenhuma' })
    expect(res.usage).toEqual({ promptTokens: 100, completionTokens: 20, totalTokens: 120 })

    const [url, opts] = fetchMock.mock.calls[0]
    // A chave vai no header, nunca na URL (vaza em log de proxy).
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).not.toContain('key-test')
    expect(opts.headers['x-goog-api-key']).toBe('key-test')
    const body = JSON.parse(opts.body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.type).toBe('OBJECT')
  })

  it('junta parts fatiadas antes de parsear', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          candidates: [
            { content: { parts: [{ text: '{"nota":3,' }, { text: '"sinais":[],"urgencia":"alta"}' }] } },
          ],
        }),
      ),
    )
    const res = await generateStructured(args())
    expect(res.object).toEqual({ nota: 3, sinais: [], urgencia: 'alta' })
  })

  it('JSON inválido vira AiError invalid_json, não SyntaxError solta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ candidates: [{ content: { parts: [{ text: '{"nota": 7' }] } }] }),
      ),
    )
    await expect(generateStructured(args())).rejects.toMatchObject({
      code: 'invalid_json',
    })
  })

  it('mapeia 403 para invalid_key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errResponse(403, { error: { message: 'forbidden' } })),
    )
    await expect(generateStructured(args())).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })
})

describe('generateStructured — OpenAI', () => {
  it('usa response_format json_schema estrito e parseia o content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: '{"nota":9,"sinais":["x"],"urgencia":"alta"}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateStructured(args({ provider: 'openai', model: 'gpt-test' }))
    expect(res.object).toEqual({ nota: 9, sinais: ['x'], urgencia: 'alta' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.strict).toBe(true)
    // O modo estrito exige objetos fechados.
    expect(body.response_format.json_schema.schema.additionalProperties).toBe(false)
  })
})

describe('generateStructured — Anthropic', () => {
  it('obriga a tool e devolve o input do tool_use como objeto', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', input: { nota: 5, sinais: [], urgencia: 'nenhuma' } },
        ],
        usage: { input_tokens: 80, output_tokens: 30 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateStructured(args({ provider: 'anthropic', model: 'claude-test' }))
    expect(res.object).toEqual({ nota: 5, sinais: [], urgencia: 'nenhuma' })
    expect(res.usage).toEqual({ promptTokens: 80, completionTokens: 30, totalTokens: 110 })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'registrar_resultado' })
    expect(body.tools[0].input_schema).toEqual(SCHEMA)
  })

  it('sem tool_use na resposta vira empty_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'oops' }] })),
    )
    await expect(
      generateStructured(args({ provider: 'anthropic' })),
    ).rejects.toMatchObject({ code: 'empty_response' })
  })
})
