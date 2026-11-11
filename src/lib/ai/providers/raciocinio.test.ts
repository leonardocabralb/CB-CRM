import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateReply } from '../generate'
import type { AiConfig } from '../types'
import { generateAnthropic } from './anthropic'
import { generateGemini, geminiText } from './gemini'
import { anthropicRaciocinaPorPadrao, geminiRaciocinaPorPadrao, mostraRaciocinio } from './raciocinio'

// ============================================================
// NOSSO (10/11/2026, `.claude/rules/ia-sandbox.md`): o Playground mostra o
// RESUMO do raciocínio do modelo. Só ele pede (`raciocinio`/`mostrarRaciocinio`);
// o turno e a retomada nunca — e sem o pedido o corpo enviado é o de sempre,
// byte a byte. O pedido só vai aos modelos que JÁ raciocinam por padrão:
// neles, muda só o que volta, não o que o modelo pensa nem o custo.
// ============================================================

afterEach(() => vi.unstubAllGlobals())

const MENSAGENS = [{ role: 'user' as const, content: 'oi' }]

function respostaDaAnthropic(content: unknown[]) {
  return new Response(
    JSON.stringify({ content, stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } }),
    { status: 200 },
  )
}

function respostaDoGemini(parts: unknown[]) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    }),
    { status: 200 },
  )
}

function corpoEnviado(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, unknown>
}

describe('quais modelos já raciocinam por padrão', () => {
  it('Anthropic: a família 5, Fable e Mythos sim; a 4.x e ids desconhecidos não', () => {
    for (const m of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-mythos-5-1']) {
      expect(anthropicRaciocinaPorPadrao(m), m).toBe(true)
    }
    for (const m of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5-20251101', 'gpt-5', 'claude-novo']) {
      expect(anthropicRaciocinaPorPadrao(m), m).toBe(false)
    }
  })

  it('Gemini: 2.5 em diante, fora os "lite"', () => {
    expect(geminiRaciocinaPorPadrao('gemini-3.8-flash')).toBe(true)
    expect(geminiRaciocinaPorPadrao('gemini-2.5-pro')).toBe(true)
    expect(geminiRaciocinaPorPadrao('gemini-3.5-flash-lite')).toBe(false)
    expect(geminiRaciocinaPorPadrao('gemini-2.0-flash')).toBe(false)
    expect(geminiRaciocinaPorPadrao('gemma-4-31b-it')).toBe(false)
    expect(geminiRaciocinaPorPadrao('gemini-flash-latest')).toBe(false)
  })

  it('OpenAI nunca (o chat completions não devolve o resumo); o provedor decide a régua', () => {
    expect(mostraRaciocinio('openai', 'gpt-5')).toBe(false)
    expect(mostraRaciocinio('anthropic', 'claude-sonnet-5-5')).toBe(true)
    expect(mostraRaciocinio('gemini', 'claude-sonnet-5-5')).toBe(false)
  })
})

describe('Anthropic', () => {
  it('sem o pedido, o corpo NÃO leva `thinking` (o turno e a retomada)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaDaAnthropic([{ type: 'text', text: 'Olá!' }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateAnthropic({ apiKey: 'k', model: 'claude-sonnet-5-5', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000 })
    expect(Object.keys(corpoEnviado(fetchMock)).sort()).toEqual(['max_tokens', 'messages', 'model', 'system'])
    expect(r).toEqual({ text: 'Olá!', usage: expect.any(Object) })
  })

  it('com o pedido, num modelo da família 5: `adaptive` + `summarized`, e o resumo volta à parte', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaDaAnthropic([
        { type: 'thinking', thinking: 'A cliente é gestante. ', signature: 'x' },
        { type: 'thinking', thinking: '', signature: 'y' },
        { type: 'text', text: 'Olá!' },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateAnthropic({ apiKey: 'k', model: 'claude-sonnet-5-5', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000, raciocinio: true })
    expect(corpoEnviado(fetchMock).thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(r.text).toBe('Olá!')
    expect(r.raciocinio).toBe('A cliente é gestante.')
  })

  it('com o pedido, num modelo 4.x: nada muda (pedir mudaria a resposta testada)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaDaAnthropic([{ type: 'text', text: 'Olá!' }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateAnthropic({ apiKey: 'k', model: 'claude-opus-4-8', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000, raciocinio: true })
    expect(corpoEnviado(fetchMock).thinking).toBeUndefined()
    expect(r.raciocinio).toBeUndefined()
  })

  it('o raciocínio nunca entra no texto da resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respostaDaAnthropic([
        { type: 'thinking', thinking: 'segredo do pedido' },
        { type: 'text', text: 'Resposta.' },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateAnthropic({ apiKey: 'k', model: 'claude-haiku-5-5', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000, raciocinio: true })
    expect(r.text).toBe('Resposta.')
  })
})

describe('Gemini', () => {
  it('sem o pedido, o `generationConfig` é o de sempre', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaDoGemini([{ text: 'Olá!' }]))
    vi.stubGlobal('fetch', fetchMock)
    await generateGemini({ apiKey: 'k', model: 'gemini-3.8-flash', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000 })
    expect(corpoEnviado(fetchMock).generationConfig).toEqual({ maxOutputTokens: expect.any(Number) })
  })

  it('com o pedido: `includeThoughts`, e a part `thought` vira o raciocínio, nunca a resposta', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaDoGemini([{ text: 'Pensei assim.', thought: true }, { text: 'Olá!' }]))
    vi.stubGlobal('fetch', fetchMock)
    const r = await generateGemini({ apiKey: 'k', model: 'gemini-3.8-flash', systemPrompt: 'S', messages: MENSAGENS, timeoutMs: 1000, raciocinio: true })
    expect(corpoEnviado(fetchMock).generationConfig).toEqual({
      maxOutputTokens: expect.any(Number),
      thinkingConfig: { includeThoughts: true },
    })
    expect(r.text).toBe('Olá!')
    expect(r.raciocinio).toBe('Pensei assim.')
  })

  it('`geminiText` ignora a part de raciocínio', () => {
    expect(geminiText({ candidates: [{ content: { parts: [{ text: 'a', thought: true }, { text: 'b' }] } }] })).toBe('b')
  })
})

describe('generateReply', () => {
  const config: AiConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    radarModel: null,
    apiKey: 'k',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 5,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }

  it('só pede o raciocínio com `mostrarRaciocinio`, e o devolve junto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respostaDaAnthropic([{ type: 'text', text: 'Sem.' }]))
      .mockResolvedValueOnce(respostaDaAnthropic([{ type: 'thinking', thinking: 'Por quê.' }, { type: 'text', text: 'Com.' }]))
    vi.stubGlobal('fetch', fetchMock)

    const sem = await generateReply({ config, systemPrompt: 'S', messages: MENSAGENS })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).thinking).toBeUndefined()
    expect(sem).toEqual({ text: 'Sem.', handoff: false, usage: expect.any(Object) })

    const com = await generateReply({ config, systemPrompt: 'S', messages: MENSAGENS, mostrarRaciocinio: true })
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).thinking).toEqual({ type: 'adaptive', display: 'summarized' })
    expect(com.raciocinio).toBe('Por quê.')
    expect(com.text).toBe('Com.')
  })
})
