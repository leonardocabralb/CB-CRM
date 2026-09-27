import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateReply, parseGeneration } from './generate'
import { MAX_OUTPUT_TOKENS } from './defaults'
import { validateAiCredentials } from './validate'
import { AiError, type AiConfig } from './types'

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    radarModel: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      usage: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toEqual({
      text: '',
      handoff: true,
      usage: null,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toEqual({
      text: 'Let me get a human',
      handoff: true,
      usage: null,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toEqual({
      text: 'Hi',
      handoff: false,
      usage,
    })
  })
})

describe('generateReply — OpenAI', () => {
  it('calls the chat completions endpoint and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        choices: [{ message: { content: 'Sure — happy to help!' } }],
        usage: { prompt_tokens: 42, completion_tokens: 8, total_tokens: 50 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'openai' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toEqual({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.openai.com')
    expect(opts.headers.Authorization).toBe('Bearer sk-test')
  })

  it('maps a 401 to an invalid_key AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        errResponse(401, { error: { message: 'Incorrect API key' } }),
      ),
    )

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ choices: [{ message: { content: '' } }] })),
    )
    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Gemini', () => {
  it('chama generateContent com a chave no header e mapeia papéis', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        candidates: [{ content: { parts: [{ text: 'Olá!' }] } }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'gemini', apiKey: 'g-key', model: 'gemini-test' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'Oi' },
        { role: 'assistant', content: 'Bom dia' },
        { role: 'user', content: 'Tudo bem?' },
      ],
    })

    expect(res.text).toBe('Olá!')
    expect(res.usage).toEqual({ promptTokens: 12, completionTokens: 3, totalTokens: 15 })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('generativelanguage.googleapis.com')
    // A chave vai no header, nunca na URL.
    expect(url).not.toContain('g-key')
    expect(opts.headers['x-goog-api-key']).toBe('g-key')
    const body = JSON.parse(opts.body)
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual([
      'user',
      'model',
      'user',
    ])
    expect(body.systemInstruction.parts[0].text).toBe('sys')
  })

  it('resposta vazia vira AiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(okResponse({ candidates: [{ content: { parts: [] } }] })),
    )
    await expect(
      generateReply({
        config: config({ provider: 'gemini' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Oi' }],
      }),
    ).rejects.toBeInstanceOf(AiError)
  })
})

describe('generateReply — Anthropic', () => {
  it('calls the messages endpoint with the version header and parses text blocks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'Hi there!' }],
        usage: { input_tokens: 30, output_tokens: 6 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const res = await generateReply({
      config: config({ provider: 'anthropic', apiKey: 'sk-ant-x' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Anthropic reports input/output only — total is summed by normalizeUsage.
    expect(res).toEqual({
      text: 'Hi there!',
      handoff: false,
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('api.anthropic.com')
    expect(opts.headers['x-api-key']).toBe('sk-ant-x')
    expect(opts.headers['anthropic-version']).toBeTruthy()
  })

  it('detects handoff in the model output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ content: [{ type: 'text', text: '[[HANDOFF]]' }] }),
      ),
    )
    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('drops a leading assistant turn so the payload starts on the customer', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse({ content: [{ type: 'text', text: 'ok' }] }))
    vi.stubGlobal('fetch', fetchMock)

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages).toHaveLength(1)
  })
})

// ------------------------------------------------------------
// Resposta CORTADA pelo teto de tokens (27/09/2026).
//
// Medido no Playground de um agente (gemini-3.7-flash): com o teto antigo de
// 1024, o raciocínio (~900 tokens num turno comum) mais o texto passaram do
// teto e a resposta voltou cortada no meio da frase — como resposta normal. No
// turno do agente, esse texto iria ao CLIENTE.
// ------------------------------------------------------------

describe('generateReply — resposta cortada pelo teto de tokens', () => {
  const casos = [
    {
      provedor: 'gemini' as const,
      campoDoTeto: (body: Record<string, unknown>) =>
        (body.generationConfig as { maxOutputTokens?: number }).maxOutputTokens,
      cortada: {
        candidates: [
          {
            content: { parts: [{ text: 'o melhor e-mail para enviarmos o link da' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
      },
      normal: { candidates: [{ content: { parts: [{ text: 'Olá!' }] }, finishReason: 'STOP' }] },
    },
    {
      provedor: 'openai' as const,
      campoDoTeto: (body: Record<string, unknown>) => body.max_completion_tokens,
      cortada: {
        choices: [
          { message: { content: 'o melhor e-mail para enviarmos o link da' }, finish_reason: 'length' },
        ],
      },
      normal: { choices: [{ message: { content: 'Olá!' }, finish_reason: 'stop' }] },
    },
    {
      provedor: 'anthropic' as const,
      campoDoTeto: (body: Record<string, unknown>) => body.max_tokens,
      cortada: {
        content: [{ type: 'text', text: 'o melhor e-mail para enviarmos o link da' }],
        stop_reason: 'max_tokens',
      },
      normal: { content: [{ type: 'text', text: 'Olá!' }], stop_reason: 'end_turn' },
    },
  ]

  for (const c of casos) {
    it(`${c.provedor}: cortada vira output_truncated, nunca o texto pela metade`, async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(c.cortada)))
      await expect(
        generateReply({
          config: config({ provider: c.provedor }),
          systemPrompt: 'sys',
          messages: [{ role: 'user', content: 'Oi' }],
        }),
      ).rejects.toMatchObject({ name: 'AiError', code: 'output_truncated' })
    })

    it(`${c.provedor}: parada normal devolve o texto, com o teto novo no pedido`, async () => {
      const fetchMock = vi.fn().mockResolvedValue(okResponse(c.normal))
      vi.stubGlobal('fetch', fetchMock)
      const res = await generateReply({
        config: config({ provider: c.provedor }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Oi' }],
      })
      expect(res.text).toBe('Olá!')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>
      expect(c.campoDoTeto(body)).toBe(MAX_OUTPUT_TOKENS)
    })
  }

  it('o teto é folga para o RACIOCÍNIO, não o tamanho da resposta: nunca volta a 1024', () => {
    expect(MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(8192)
  })

  // O outro sintoma medido no mesmo Playground: "Gemini returned an empty
  // response." — o raciocínio gastou o teto inteiro e nenhuma parte de texto
  // voltou. O motivo de parada é conferido ANTES do texto vazio.
  it.each([
    ['gemini' as const, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }],
    ['gemini' as const, { candidates: [{ finishReason: 'MAX_TOKENS' }] }],
    ['openai' as const, { choices: [{ message: { content: '' }, finish_reason: 'length' }] }],
    ['anthropic' as const, { content: [], stop_reason: 'max_tokens' }],
  ])('%s que gastou o teto pensando (sem texto) é output_truncated, não empty_response', async (provedor, corpo) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse(corpo)))
    await expect(
      generateReply({
        config: config({ provider: provedor }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Oi' }],
      }),
    ).rejects.toMatchObject({ code: 'output_truncated' })
  })
})

describe('validateAiCredentials', () => {
  it('resposta cortada É resposta: a chave e o modelo servem', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({ candidates: [{ content: { parts: [{ text: 'O' }] }, finishReason: 'MAX_TOKENS' }] }),
      ),
    )
    await expect(validateAiCredentials(config({ provider: 'gemini' }))).resolves.toBeUndefined()
  })

  it('as demais falhas continuam falhando', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(errResponse(401, { error: { message: 'bad key' } })),
    )
    await expect(validateAiCredentials(config({ provider: 'gemini' }))).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })
})
