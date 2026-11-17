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
  finalizeBroadcastStatus,
  depoisDaResposta,
  BroadcastError,
} = vi.hoisted(() => ({
  claimBroadcastDelivery: vi.fn(),
  planBroadcastResume: vi.fn(),
  markBroadcastSending: vi.fn(),
  releaseBroadcastDelivery: vi.fn(),
  deliverBroadcast: vi.fn(),
  finalizeBroadcastStatus: vi.fn(),
  depoisDaResposta: vi.fn(),
  BroadcastError: class BroadcastError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message)
    }
  },
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
  BroadcastError,
  deliverBroadcast,
  finalizeBroadcastStatus,
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
    finalizeBroadcastStatus,
    depoisDaResposta,
  ]) {
    f.mockReset()
  }
  finalizeBroadcastStatus.mockResolvedValue(undefined)
  releaseBroadcastDelivery.mockResolvedValue(undefined)
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

  it('⚠️⚠️ planejamento que falha DEPOIS de tomar a trava: fecha a campanha pelas linhas e solta a trava', async () => {
    // Tomar a trava apagou a posse do assistente: ele não fecha mais esta
    // campanha. Sem o fecho, ela ficava `sending` para sempre (achado A2).
    claimBroadcastDelivery.mockResolvedValue('tomada')
    planBroadcastResume.mockRejectedValue(
      new BroadcastError('nothing_to_resume', 'This broadcast has no recipients left to send', 400),
    )
    const res = await retomar()
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('nothing_to_resume')
    expect(finalizeBroadcastStatus).toHaveBeenCalledWith({ cliente: 'servico' }, 'b1')
    expect(releaseBroadcastDelivery).toHaveBeenCalledWith({ cliente: 'servico' }, 'b1', 'conta-1')
    expect(finalizeBroadcastStatus.mock.invocationCallOrder[0]).toBeLessThan(
      releaseBroadcastDelivery.mock.invocationCallOrder[0],
    )
    expect(depoisDaResposta).not.toHaveBeenCalled()
  })

  it('sem a trava (ocupada ou erro), não fecha nem solta nada que não é seu', async () => {
    for (const trava of ['ocupada', 'erro']) {
      claimBroadcastDelivery.mockResolvedValue(trava)
      await retomar()
    }
    expect(finalizeBroadcastStatus).not.toHaveBeenCalled()
    expect(releaseBroadcastDelivery).not.toHaveBeenCalled()
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
