import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// NOSSO (posse do envio, 1147): a retomada não manda nada enquanto outro
// envio roda — o assistente no navegador de quem disparou (a posse) ou outra
// retomada (a trava). O 409 leva `code: 'delivery_in_flight'` para a tela
// dizer isso no idioma dela e recarregar; a trava que não deu para conferir é
// 500 (`claim_failed`), nunca "já está rodando".
// ============================================================

const {
  claimBroadcastDelivery,
  planBroadcastResume,
  markBroadcastSending,
  releaseBroadcastDelivery,
  deliverBroadcast,
  depoisDaResposta,
} = vi.hoisted(() => ({
  claimBroadcastDelivery: vi.fn(),
  planBroadcastResume: vi.fn(),
  markBroadcastSending: vi.fn(),
  releaseBroadcastDelivery: vi.fn(),
  deliverBroadcast: vi.fn(),
  depoisDaResposta: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
  after: depoisDaResposta,
}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: { sessao: 'admin' }, accountId: 'conta-1', userId: 'u-1' })),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { broadcast: {} },
}))
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ cliente: 'servico' }) }))
vi.mock('@/lib/whatsapp/broadcast-core', () => ({
  BroadcastError: class BroadcastError extends Error {},
  deliverBroadcast,
  finalizeBroadcastStatus: vi.fn(),
}))
vi.mock('@/lib/whatsapp/broadcast-resume', () => ({
  claimBroadcastDelivery,
  planBroadcastResume,
  markBroadcastSending,
  releaseBroadcastDelivery,
  RESUME_SCOPES: ['pending', 'failed', 'all'],
}))

import { POST } from './route'

const retomar = () =>
  POST(
    new Request('http://localhost/api/whatsapp/broadcast/b1/resume', {
      method: 'POST',
      body: JSON.stringify({ scope: 'pending' }),
    }),
    { params: Promise.resolve({ id: 'b1' }) },
  ) as unknown as Promise<{ body: Record<string, unknown>; status: number }>

beforeEach(() => {
  for (const f of [
    claimBroadcastDelivery,
    planBroadcastResume,
    markBroadcastSending,
    releaseBroadcastDelivery,
    deliverBroadcast,
    depoisDaResposta,
  ]) {
    f.mockReset()
  }
  planBroadcastResume.mockResolvedValue({
    plan: { planned: [{}, {}] },
    remaining: 0,
    unsendable: 0,
  })
})

describe('POST /api/whatsapp/broadcast/[id]/resume — a posse e a trava (1147)', () => {
  it('⚠️⚠️ envio rodando (posse do assistente ou outra retomada): 409 com o código, e nada planejado nem enviado', async () => {
    claimBroadcastDelivery.mockResolvedValue('ocupada')
    const res = await retomar()
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('delivery_in_flight')
    expect(planBroadcastResume).not.toHaveBeenCalled()
    expect(depoisDaResposta).not.toHaveBeenCalled()
  })

  it('não deu para conferir a trava: 500 `claim_failed`, nunca "já está rodando"', async () => {
    claimBroadcastDelivery.mockResolvedValue('erro')
    const res = await retomar()
    expect(res.status).toBe(500)
    expect(res.body.code).toBe('claim_failed')
    expect(planBroadcastResume).not.toHaveBeenCalled()
    expect(depoisDaResposta).not.toHaveBeenCalled()
  })

  it('tomada: planeja com a sessão de quem pediu, responde 202 e entrega depois', async () => {
    claimBroadcastDelivery.mockResolvedValue('tomada')
    const res = await retomar()
    expect(res.status).toBe(202)
    expect(claimBroadcastDelivery).toHaveBeenCalledWith({ sessao: 'admin' }, 'conta-1', 'b1')
    expect(res.body).toMatchObject({ resuming: 2, remaining: 0 })
    expect(depoisDaResposta).toHaveBeenCalledTimes(1)
  })
})
