import { beforeEach, describe, expect, it, vi } from 'vitest'

// PATCH /api/cb/ia/radar — o modelo que o Radar VAI usar é conferido antes de
// gravar, inclusive quando o próprio é LIMPO e o Radar volta a herdar o do
// agente de conversa (Codex, #294): o herdado pode ter saído do ar.

const updates: Record<string, unknown>[] = []
let modelosQueFalham: string[] = []

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            is: () => ({
              maybeSingle: async () => ({ data: { id: 'cfg', provider: 'gemini', model: 'gemini-herdado' }, error: null }),
            }),
          }),
        }),
        update: (campos: Record<string, unknown>) => {
          updates.push(campos)
          const fim = { error: null, count: 1 }
          const eq: Record<string, unknown> = {}
          eq.eq = () => eq
          eq.then = (r: (v: unknown) => unknown) => r(fim)
          return eq
        },
      }),
    },
  })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { integracoesPing: {} },
}))
vi.mock('@/lib/ia-chaves/repo', () => ({ lerChave: vi.fn(async () => ({ chave: 'g-chave', ilegivel: false })) }))
const validateAiCredentials = vi.fn(async (cfg: { model: string }) => {
  if (modelosQueFalham.includes(cfg.model)) {
    const { AiError } = await import('@/lib/ai/types')
    throw new AiError('model not found', { code: 'provider_error', upstreamStatus: 404 })
  }
})
vi.mock('@/lib/ai/validate', () => ({ validateAiCredentials: (cfg: { model: string }) => validateAiCredentials(cfg) }))

import { PATCH } from './route'

function pedido(radar_model: string | null) {
  return new Request('http://x/api/cb/ia/radar', { method: 'PATCH', body: JSON.stringify({ radar_model }) })
}

beforeEach(() => {
  updates.length = 0
  modelosQueFalham = []
  validateAiCredentials.mockClear()
})

describe('PATCH /api/cb/ia/radar', () => {
  it('o próprio é conferido e gravado', async () => {
    const res = await PATCH(pedido('gemini-radar'))
    expect(res.status).toBe(200)
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-radar'])
    expect(updates).toEqual([{ radar_model: 'gemini-radar' }])
  })

  it('LIMPAR confere o herdado; herdado fora do ar = recusa, nada gravado', async () => {
    modelosQueFalham = ['gemini-herdado']
    const res = await PATCH(pedido(null))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'radar_model_invalid', modelo: 'gemini-herdado' })
    expect(updates).toHaveLength(0)
  })

  it('LIMPAR com o herdado respondendo grava o nulo', async () => {
    const res = await PATCH(pedido(''))
    expect(res.status).toBe(200)
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-herdado'])
    expect(updates).toEqual([{ radar_model: null }])
  })
})
