import { beforeEach, describe, expect, it, vi } from 'vitest'

// O prazo que chega ao provedor: o teto global (30 s) para todo mundo, e o
// teto PRÓPRIO só para quem o pede (a resposta do agente, 45 s — 09/11/2026).
const chamadas: Array<{ timeoutMs: number }> = []
vi.mock('./providers/openai', () => ({
  generateOpenAi: vi.fn(async (a: { timeoutMs: number }) => {
    chamadas.push({ timeoutMs: a.timeoutMs })
    return { text: 'ok', usage: null }
  }),
}))

import { PRAZO_DA_GERACAO_MS } from '@/lib/ia-agentes/agente'
import { PRAZO_DO_TURNO_MS, RESERVA_DO_ENVIO_MS } from '@/lib/ia-agentes/fila'

import { aiRequestTimeoutMs } from './defaults'
import { generateReply } from './generate'
import type { AiConfig } from './types'

const config: AiConfig = {
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
}
const base = { config, systemPrompt: 's', messages: [{ role: 'user' as const, content: 'oi' }] }

beforeEach(() => {
  chamadas.length = 0
})

describe('o prazo da geração', () => {
  it('sem nada: o teto global (30 s)', async () => {
    await generateReply(base)
    expect(chamadas[0].timeoutMs).toBe(aiRequestTimeoutMs())
    expect(aiRequestTimeoutMs()).toBe(30_000)
  })

  it('o `timeoutMs` nunca passa do teto global quando não há teto próprio', async () => {
    await generateReply({ ...base, timeoutMs: 40_000 })
    expect(chamadas[0].timeoutMs).toBe(30_000)
  })

  it('⚠️ com o teto do agente (45 s), o que sobra do turno pode passar dos 30 s', async () => {
    await generateReply({ ...base, timeoutMs: 44_000, tetoMs: PRAZO_DA_GERACAO_MS })
    expect(chamadas[0].timeoutMs).toBe(44_000)
    await generateReply({ ...base, timeoutMs: 90_000, tetoMs: PRAZO_DA_GERACAO_MS })
    expect(chamadas[1].timeoutMs).toBe(45_000)
    await generateReply({ ...base, tetoMs: PRAZO_DA_GERACAO_MS })
    expect(chamadas[2].timeoutMs).toBe(45_000)
  })

  it('o turno cabe os 45 s da geração, a reserva do envio e o preparo — escritos à mão', () => {
    expect(PRAZO_DA_GERACAO_MS).toBe(45_000)
    expect(PRAZO_DO_TURNO_MS).toBe(60_000)
    expect(PRAZO_DO_TURNO_MS - RESERVA_DO_ENVIO_MS - PRAZO_DA_GERACAO_MS).toBeGreaterThanOrEqual(5_000)
  })
})
