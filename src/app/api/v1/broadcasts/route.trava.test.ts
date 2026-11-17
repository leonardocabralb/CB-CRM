import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// NOSSO (posse do envio, 1147): o disparo pela API toma a TRAVA da retomada
// antes do `after()`. Sem ela, o "Retomar" da tela da campanha durante este
// envio achava a trava livre e mandava pelo servidor, de novo, o que o
// `after()` ainda ia mandar — o modelo pago em dobro.
//
// A rota é do upstream (e o `route.test.ts` ao lado é de outro pino): este
// arquivo segura só a trava.
// ============================================================

const {
  createBroadcast,
  deliverBroadcast,
  claimBroadcastDelivery,
  releaseBroadcastDelivery,
  depoisDaResposta,
} = vi.hoisted(() => ({
  createBroadcast: vi.fn(),
  deliverBroadcast: vi.fn(),
  claimBroadcastDelivery: vi.fn(),
  releaseBroadcastDelivery: vi.fn(),
  depoisDaResposta: vi.fn(),
}))

vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: depoisDaResposta,
}))
vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({ supabase: { cliente: 'da-api' }, accountId: 'conta-1' })),
}))
vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'usuario-de-auditoria'),
  ContactError: class ContactError extends Error {
    status = 400
  },
}))
vi.mock('@/lib/whatsapp/broadcast-core', () => {
  class BroadcastError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message)
    }
  }
  return { createBroadcast, deliverBroadcast, BroadcastError }
})
vi.mock('@/lib/whatsapp/broadcast-resume', () => ({
  claimBroadcastDelivery,
  releaseBroadcastDelivery,
}))

import { POST } from './route'
import { BroadcastError } from '@/lib/whatsapp/broadcast-core'

const pedido = () =>
  new Request('http://localhost/api/v1/broadcasts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer x' },
    body: JSON.stringify({
      template_name: 'lembrete',
      recipients: [{ to: '+5583980000016', params: ['Ana'] }],
    }),
  })

const PLANO = { broadcastId: 'b1', planned: [{}], rejected: 0, channelId: 'canal-1' }

/** Roda o que a rota deixou para depois da resposta. */
async function rodarDepoisDaResposta() {
  expect(depoisDaResposta).toHaveBeenCalledTimes(1)
  await depoisDaResposta.mock.calls[0][0]()
}

beforeEach(() => {
  for (const f of [createBroadcast, deliverBroadcast, claimBroadcastDelivery, releaseBroadcastDelivery, depoisDaResposta]) {
    f.mockReset()
  }
  createBroadcast.mockResolvedValue(PLANO)
  deliverBroadcast.mockResolvedValue(undefined)
  releaseBroadcastDelivery.mockResolvedValue(undefined)
})

describe('POST /api/v1/broadcasts — a trava da retomada (1147)', () => {
  it('⚠️⚠️ toma a trava ANTES de responder, pela conta e pelo cliente da API', async () => {
    claimBroadcastDelivery.mockResolvedValue('tomada')
    const res = await POST(pedido())
    expect(res.status).toBe(202)
    expect(claimBroadcastDelivery).toHaveBeenCalledWith({ cliente: 'da-api' }, 'conta-1', 'b1')
    // Tomada antes do `after()`: o Retomar que chegar durante o envio já a acha.
    expect(claimBroadcastDelivery.mock.invocationCallOrder[0]).toBeLessThan(
      depoisDaResposta.mock.invocationCallOrder[0],
    )
  })

  it('tomada: entrega e SOLTA a trava no fim', async () => {
    claimBroadcastDelivery.mockResolvedValue('tomada')
    await POST(pedido())
    await rodarDepoisDaResposta()
    expect(deliverBroadcast).toHaveBeenCalledWith({ cliente: 'da-api' }, PLANO)
    expect(releaseBroadcastDelivery).toHaveBeenCalledWith({ cliente: 'da-api' }, 'b1', 'conta-1')
    expect(deliverBroadcast.mock.invocationCallOrder[0]).toBeLessThan(
      releaseBroadcastDelivery.mock.invocationCallOrder[0],
    )
  })

  it('a entrega estourou: a trava é solta mesmo assim', async () => {
    claimBroadcastDelivery.mockResolvedValue('tomada')
    deliverBroadcast.mockRejectedValue(new Error('boom'))
    await POST(pedido())
    await expect(rodarDepoisDaResposta()).rejects.toThrow('boom')
    expect(releaseBroadcastDelivery).toHaveBeenCalledTimes(1)
  })

  it('⚠️⚠️ ocupada (outra passada já entrega os pendentes): NÃO entrega nem solta a trava alheia', async () => {
    claimBroadcastDelivery.mockResolvedValue('ocupada')
    const res = await POST(pedido())
    expect(res.status).toBe(202)
    await rodarDepoisDaResposta()
    expect(deliverBroadcast).not.toHaveBeenCalled()
    expect(releaseBroadcastDelivery).not.toHaveBeenCalled()
  })

  it('erro ao tomar: entrega como antes (a campanha acabou de nascer) e não solta trava que não é sua', async () => {
    claimBroadcastDelivery.mockResolvedValue('erro')
    await POST(pedido())
    await rodarDepoisDaResposta()
    expect(deliverBroadcast).toHaveBeenCalledTimes(1)
    expect(releaseBroadcastDelivery).not.toHaveBeenCalled()
  })

  it('a criação recusada não toma trava nem agenda envio', async () => {
    createBroadcast.mockRejectedValueOnce(
      new BroadcastError('meta_channel_required', 'Broadcasts require an official Meta number', 400),
    )
    const res = await POST(pedido())
    expect(res.status).toBe(400)
    expect(claimBroadcastDelivery).not.toHaveBeenCalled()
    expect(depoisDaResposta).not.toHaveBeenCalled()
  })
})
