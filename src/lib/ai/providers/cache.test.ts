import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateAnthropic, sistemaDaAnthropic, TTL_DO_CACHE, usoDaAnthropic } from './anthropic'
import { generateGemini, geminiUsage } from './gemini'
import { normalizeUsage } from './shared'

// ============================================================
// NOSSO (09/11/2026, `.claude/rules/ia-cache-do-pedido.md`): o pedido do
// agente vai à Anthropic em pedaços, com os FIXOS marcados para o cache de
// 1 h, e o uso devolve a entrada INTEIRA (o resto sem cache + o gravado + o
// lido) com as duas partes do cache à parte. O Gemini faz cache sozinho: o
// lido já vem dentro de `promptTokenCount`.
// ============================================================

afterEach(() => vi.unstubAllGlobals())

function respostaDaAnthropic(usage: Record<string, number>) {
  return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Olá!' }], stop_reason: 'end_turn', usage }), { status: 200 })
}

describe('Anthropic: o system em pedaços com cache', () => {
  it('sem pedaços, o system é o texto (como sempre)', () => {
    expect(sistemaDaAnthropic('pedido inteiro', undefined)).toBe('pedido inteiro')
    expect(sistemaDaAnthropic('pedido inteiro', [])).toBe('pedido inteiro')
  })

  it('com pedaços: um bloco por pedaço, a marca de cache de 1 h SÓ nos fixos', () => {
    const blocos = sistemaDaAnthropic('A\n\nB\n\nC', [
      { texto: 'A', cache: true },
      { texto: '\n\nB', cache: true },
      { texto: '\n\nC', cache: false },
    ])
    expect(TTL_DO_CACHE).toBe('1h')
    expect(blocos).toEqual([
      { type: 'text', text: 'A', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: '\n\nB', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: '\n\nC' },
    ])
  })

  it('o corpo enviado leva os blocos', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respostaDaAnthropic({ input_tokens: 10, output_tokens: 5 }))
    vi.stubGlobal('fetch', fetchMock)
    await generateAnthropic({
      apiKey: 'k',
      model: 'claude-sonnet-5-5',
      systemPrompt: 'A\n\nC',
      systemPartes: [
        { texto: 'A', cache: true },
        { texto: '\n\nC', cache: false },
      ],
      messages: [{ role: 'user', content: 'oi' }],
      timeoutMs: 1000,
    })
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(corpo.system).toEqual([
      { type: 'text', text: 'A', cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: '\n\nC' },
    ])
  })

  it('⚠️ o uso soma a entrada INTEIRA (resto + gravado + lido) — sem isso o custo cairia para uma fração', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respostaDaAnthropic({ input_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 10_518, output_tokens: 500 }),
      ),
    )
    const r = await generateAnthropic({ apiKey: 'k', model: 'm', systemPrompt: 'x', messages: [{ role: 'user', content: 'oi' }], timeoutMs: 1000 })
    expect(r.usage).toEqual({ promptTokens: 10_818, completionTokens: 500, totalTokens: 11_318, cacheReadTokens: 10_518 })
  })

  it('a 1ª chamada GRAVA: o gravado vem à parte', () => {
    expect(usoDaAnthropic({ input_tokens: 167, cache_creation_input_tokens: 10_518, output_tokens: 272 })).toEqual({
      promptTokens: 10_685,
      completionTokens: 272,
      totalTokens: 10_957,
      cacheWriteTokens: 10_518,
    })
  })

  it('sem cache, o uso é o de antes (sem as chaves do cache)', () => {
    expect(usoDaAnthropic({ input_tokens: 30, output_tokens: 6 })).toEqual({ promptTokens: 30, completionTokens: 6, totalTokens: 36 })
    expect(usoDaAnthropic(undefined)).toBeNull()
  })
})

describe('Gemini: o cache implícito no uso', () => {
  it('o lido do cache já está na entrada e sai também à parte', () => {
    expect(
      geminiUsage({ usageMetadata: { promptTokenCount: 7000, candidatesTokenCount: 100, totalTokenCount: 8900, cachedContentTokenCount: 4200 } }),
    ).toEqual({ promptTokens: 7000, completionTokens: 100, totalTokens: 8900, cacheReadTokens: 4200 })
    expect(geminiUsage({ usageMetadata: { promptTokenCount: 7000, candidatesTokenCount: 100, totalTokenCount: 8900 } })).toEqual({
      promptTokens: 7000,
      completionTokens: 100,
      totalTokens: 8900,
    })
  })

  it('o Gemini manda o texto inteiro, mesmo com os pedaços (o cache dele é sozinho)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await generateGemini({
      apiKey: 'k',
      model: 'gemini-3.8-flash',
      systemPrompt: 'A\n\nC',
      systemPartes: [
        { texto: 'A', cache: true },
        { texto: '\n\nC', cache: false },
      ],
      messages: [{ role: 'user', content: 'oi' }],
      timeoutMs: 1000,
    })
    const corpo = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(corpo.systemInstruction).toEqual({ parts: [{ text: 'A\n\nC' }] })
  })
})

describe('normalizeUsage: as chaves do cache só quando há', () => {
  it('zero ou ausente não vira chave', () => {
    expect(normalizeUsage({ prompt: 10, completion: 2, cacheRead: 0, cacheWrite: undefined })).toEqual({
      promptTokens: 10,
      completionTokens: 2,
      totalTokens: 12,
    })
  })
})
