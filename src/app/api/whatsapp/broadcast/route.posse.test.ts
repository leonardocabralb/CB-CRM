import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// NOSSO (posse do envio, 1147): a rota do lote renova a posse do assistente
// ANTES do primeiro envio e de novo a cada minuto do lote, e para sem ela.
//
// Renovada só no navegador, a posse (5 min) não cobria um lote que se
// arrastasse no servidor (a Meta lenta ou pendurada) nem um pedido que chegasse
// atrasado: a retomada assumia no meio e os dois mandavam os mesmos pendentes —
// o modelo pago em dobro (revisão independente do Lote F, achado A1).
// ============================================================

const { eventos, renovarPosseDoDisparo } = vi.hoisted(() => ({
  eventos: [] as string[],
  renovarPosseDoDisparo: vi.fn(),
}))

const db = {
  from() {
    const q = {
      update: () => q,
      eq: () => q,
      async select() {
        return { data: [{ id: 'x' }], error: null }
      },
    }
    return q
  },
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: db, accountId: 'conta-1', userId: 'u-1' })),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { broadcast: {} },
}))
vi.mock('@/lib/cb-channels/resolve-meta', () => ({
  resolveMetaChannel: vi.fn(async () => ({ channelId: 'canal-1', phoneNumberId: 'pn-1', accessToken: 'tok' })),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({ malformed: false, row: null, language: 'pt_BR' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn(async ({ to }: { to: string }) => {
    eventos.push(`enviou ${to}`)
    // Cada envio "leva" 40 s (a Meta lenta do cenário do achado).
    vi.advanceTimersByTime(40_000)
    return { messageId: `wamid.${to}` }
  }),
}))
vi.mock('@/lib/whatsapp/broadcast-posse', () => ({ renovarPosseDoDisparo }))

import { POST } from './route'

type Resposta = { body: { code?: string; results: { recipient_id?: string; status: string }[] }; status: number }

const DESTINATARIOS = [
  { recipient_id: 'r1', phone: '5583988745316', params: [] },
  { recipient_id: 'r2', phone: '5583988745317', params: [] },
  { recipient_id: 'r3', phone: '5583988745318', params: [] },
]

const lote = (extra: Record<string, unknown>) =>
  POST(
    new Request('http://localhost/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({
        recipients: DESTINATARIOS,
        template_name: 'modelo',
        template_language: 'pt_BR',
        ...extra,
      }),
    }),
  ) as unknown as Promise<Resposta>

beforeEach(() => {
  vi.useFakeTimers()
  eventos.length = 0
  renovarPosseDoDisparo.mockReset()
  renovarPosseDoDisparo.mockImplementation(async (_db: unknown, broadcastId: string, token: string) => {
    eventos.push(`renovou ${broadcastId}/${token}`)
    return { situacao: 'mantida', prazo: 'x' }
  })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('POST /api/whatsapp/broadcast — a posse do assistente (1147)', () => {
  it('⚠️⚠️ renova ANTES do primeiro envio (o pedido pode ter chegado atrasado)', async () => {
    const res = await lote({ broadcast_id: 'bc-1', posse: 'tok-1' })
    expect(res.status).toBe(200)
    expect(eventos[0]).toBe('renovou bc-1/tok-1')
    expect(eventos[1]).toBe('enviou 5583988745316')
  })

  it('⚠️⚠️ e de novo quando o lote passa de 1 min (cada envio aqui leva 40 s)', async () => {
    await lote({ broadcast_id: 'bc-1', posse: 'tok-1' })
    expect(eventos).toEqual([
      'renovou bc-1/tok-1',
      'enviou 5583988745316',
      'enviou 5583988745317',
      'renovou bc-1/tok-1',
      'enviou 5583988745318',
    ])
  })

  it('⚠️⚠️ posse perdida no início: 409, NENHUM envio', async () => {
    renovarPosseDoDisparo.mockResolvedValueOnce({ situacao: 'perdida' })
    const res = await lote({ broadcast_id: 'bc-1', posse: 'tok-1' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('posse_perdida')
    expect(res.body.results).toEqual([])
    expect(eventos.filter((e) => e.startsWith('enviou'))).toEqual([])
  })

  it('⚠️⚠️ posse perdida no MEIO do lote: para, e devolve só o que saiu (o resto fica pending)', async () => {
    renovarPosseDoDisparo
      .mockImplementationOnce(async () => ({ situacao: 'mantida', prazo: 'x' }))
      .mockImplementationOnce(async () => ({ situacao: 'perdida' }))
    const res = await lote({ broadcast_id: 'bc-1', posse: 'tok-1' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('posse_perdida')
    expect(eventos.filter((e) => e.startsWith('enviou'))).toEqual([
      'enviou 5583988745316',
      'enviou 5583988745317',
    ])
    expect(res.body.results.map((r) => [r.recipient_id, r.status])).toEqual([
      ['r1', 'sent'],
      ['r2', 'sent'],
    ])
  })

  it('não deu para conferir a posse: 409 posse_incerta, sem enviar', async () => {
    renovarPosseDoDisparo.mockResolvedValueOnce({ situacao: 'erro', mensagem: 'timeout' })
    const res = await lote({ broadcast_id: 'bc-1', posse: 'tok-1' })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('posse_incerta')
    expect(eventos.filter((e) => e.startsWith('enviou'))).toEqual([])
  })

  it('pedido sem a posse (aba aberta antes do deploy): manda como antes, sem renovar', async () => {
    const res = await lote({})
    expect(res.status).toBe(200)
    expect(renovarPosseDoDisparo).not.toHaveBeenCalled()
    expect(eventos.filter((e) => e.startsWith('enviou'))).toHaveLength(3)
  })
})
