import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// NOSSO (1151): a rota do lote RESERVA cada linha antes da Meta
// (`pending` → `uncertain`) e só a recusa COMPROVADA (4xx) vira `failed`.
//
// Antes, o 5xx, o tempo esgotado e o erro de rede da Meta voltavam `failed`,
// e o "Tentar de novo os que falharam" mandava de novo o que podia ter saído:
// o modelo PAGO em dobro a um cliente (CLAUDE.md, 8e). E a linha que não se
// reserva (outro envio a tem, ou já saiu) não vai à Meta.
// ============================================================

type Update = { patch: Record<string, unknown>; filtros: [string, unknown][] }

const { enviarModelo } = vi.hoisted(() => ({ enviarModelo: vi.fn() }))
const updates: Update[] = []
/** A resposta da RESERVA por linha (padrão: reservou). */
const reservas = new Map<string, { data: unknown[] | null; error: unknown }>()
let modelo: Record<string, unknown> | null = null

const db = {
  from(nome: string) {
    expect(nome).toBe('broadcast_recipients')
    return {
      update(patch: Record<string, unknown>) {
        const filtros: [string, unknown][] = []
        const q = {
          eq(col: string, val: unknown) {
            filtros.push([col, val])
            return q
          },
          in(col: string, vals: unknown[]) {
            filtros.push([`${col} in`, vals])
            return q
          },
          async select() {
            updates.push({ patch, filtros })
            const id = String(filtros.find(([c]) => c === 'id')?.[1])
            if (patch.status === 'uncertain') return reservas.get(id) ?? { data: [{ id }], error: null }
            return { data: [{ id }], error: null }
          },
        }
        return q
      },
    }
  },
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: db, accountId: 'conta-1', userId: 'u-1' })),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('next/server', () => ({
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ body, init }) },
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => ({ status: 429 }),
  RATE_LIMITS: { broadcast: {} },
}))
vi.mock('@/lib/cb-channels/resolve-meta', () => ({
  resolveMetaChannel: vi.fn(async () => ({
    channelId: 'canal-1',
    phoneNumberId: 'pn-1',
    accessToken: 'EAABsegredodotoken123',
  })),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({ malformed: false, row: modelo, language: 'pt_BR' })),
}))
vi.mock('@/lib/whatsapp/meta-api', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/meta-api')>()),
  sendTemplateMessage: enviarModelo,
}))

import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { POST } from './route'

type Corpo = {
  results: Record<string, unknown>[]
  sent: number
  failed: number
  uncertain: number
}
const lote = async (recipients: Record<string, unknown>[]) => {
  const res = (await POST(
    new Request('http://localhost/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({ recipients, template_name: 'modelo', template_language: 'pt_BR' }),
    }),
  )) as unknown as { body: Corpo }
  return res.body
}
const r1 = { recipient_id: 'r1', phone: '5583988745316', params: [] }

beforeEach(() => {
  updates.length = 0
  reservas.clear()
  modelo = null
  enviarModelo.mockReset()
  enviarModelo.mockImplementation(async ({ to }: { to: string }) => ({ messageId: `wamid.${to}` }))
})

describe('POST /api/whatsapp/broadcast — a reserva e a entrega incerta (1151)', () => {
  it('⚠️⚠️ 5xx da Meta: a linha FICA incerta (só o motivo é gravado), nunca `failed`', async () => {
    enviarModelo.mockRejectedValue(new MetaApiError('Service temporarily unavailable', { httpStatus: 503, code: 2 }))
    const corpo = await lote([r1])
    expect(corpo.results).toEqual([
      expect.objectContaining({ status: 'uncertain', recipient_id: 'r1', anotado: true }),
    ])
    expect(corpo).toMatchObject({ sent: 0, failed: 0, uncertain: 1 })
    expect(updates.map((u) => u.patch)).toEqual([
      { status: 'uncertain', error_message: null },
      { error_message: 'Service temporarily unavailable' },
    ])
    expect(updates[1].filtros).toEqual([
      ['id', 'r1'],
      ['status', 'uncertain'],
    ])
  })

  it('⚠️⚠️ disjuntor: a 1ª incerta PARA o lote — os seguintes nem são reservados nem vão à Meta', async () => {
    enviarModelo
      .mockResolvedValueOnce({ messageId: 'wamid.1' })
      .mockRejectedValueOnce(new MetaApiError('Service temporarily unavailable', { httpStatus: 503 }))
    const corpo = await lote([
      r1,
      { recipient_id: 'r2', phone: '5583988745317', params: [] },
      { recipient_id: 'r3', phone: '5583988745318', params: [] },
    ])
    expect(enviarModelo).toHaveBeenCalledTimes(2)
    expect(corpo.results.map((r) => [r.recipient_id, r.status])).toEqual([
      ['r1', 'sent'],
      ['r2', 'uncertain'],
    ])
    expect(corpo).toMatchObject({ sent: 1, failed: 0, uncertain: 1 })
    // r3 não foi reservado: continua `pending` (não saiu), para o Retomar.
    expect(updates.some((u) => u.filtros.some(([c, v]) => c === 'id' && v === 'r3'))).toBe(false)
  })

  it('a recusa (4xx) NÃO para o lote: o próximo segue', async () => {
    enviarModelo.mockRejectedValueOnce(new MetaApiError('recusado', { httpStatus: 400, code: 131026 }))
    const corpo = await lote([r1, { recipient_id: 'r2', phone: '5583988745317', params: [] }])
    expect(enviarModelo).toHaveBeenCalledTimes(2)
    expect(corpo.results.map((r) => r.status)).toEqual(['failed', 'sent'])
  })

  it('⚠️⚠️ erro de rede ou resposta 200 ilegível (a Meta pode ter aceitado): incerta', async () => {
    for (const erro of [new TypeError('fetch failed'), new SyntaxError('Unexpected end of JSON input')]) {
      updates.length = 0
      enviarModelo.mockRejectedValueOnce(erro)
      const corpo = await lote([r1])
      expect(corpo.results[0]).toMatchObject({ status: 'uncertain' })
      expect(updates.some((u) => u.patch.status === 'failed')).toBe(false)
    }
  })

  it('⚠️ "fora da lista" (4xx) numa variante e rede na seguinte: incerta (a 2ª pode ter saído)', async () => {
    enviarModelo
      .mockRejectedValueOnce(
        new MetaApiError('(#131030) Recipient phone number not in allowed list', { httpStatus: 400, code: 131030 }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))
    const corpo = await lote([r1])
    expect(enviarModelo).toHaveBeenCalledTimes(2)
    expect(corpo.results[0]).toMatchObject({ status: 'uncertain' })
  })

  it('⚠️⚠️ linha que NÃO se reserva (outro envio a tem, ou já saiu): não vai à Meta — `skipped`', async () => {
    reservas.set('r1', { data: [], error: null })
    const corpo = await lote([r1])
    expect(enviarModelo).not.toHaveBeenCalled()
    expect(corpo.results).toEqual([{ phone: r1.phone, status: 'skipped', recipient_id: 'r1' }])
    expect(corpo).toMatchObject({ sent: 0, failed: 0, uncertain: 0 })
    expect(updates).toHaveLength(1)
  })

  it('reserva que falha: não vai à Meta, e a linha é falha (nada saiu)', async () => {
    reservas.set('r1', { data: null, error: { message: 'timeout' } })
    const corpo = await lote([r1])
    expect(enviarModelo).not.toHaveBeenCalled()
    expect(corpo.results[0]).toMatchObject({ status: 'failed', recipient_id: 'r1' })
    expect(corpo.results[0]).not.toHaveProperty('anotado')
    expect(updates).toHaveLength(1)
  })

  it('o modelo que não MONTA nunca chega à Meta nem é reservado: `failed` com o motivo', async () => {
    modelo = {
      name: 'modelo',
      language: 'pt_BR',
      body_text: 'Olá',
      header_type: 'image',
      header_media_url: null,
      buttons: [],
    }
    const corpo = await lote([r1])
    expect(enviarModelo).not.toHaveBeenCalled()
    expect(updates).toEqual([])
    expect(corpo.results[0]).toMatchObject({ status: 'failed', recipient_id: 'r1' })
    expect(String(corpo.results[0].error)).toMatch(/^Template cannot be sent: image header requires a media link/)
  })

  it('a mensagem da Meta que ECOA o token sai limpa no resultado e no banco', async () => {
    enviarModelo.mockRejectedValue(
      new MetaApiError('Malformed access token EAABsegredodotoken123', { httpStatus: 401, code: 190 }),
    )
    const corpo = await lote([r1])
    expect(corpo.results[0]).toMatchObject({ status: 'failed', error: 'Malformed access token «token»' })
    expect(updates[1].patch).toEqual({ status: 'failed', error_message: 'Malformed access token «token»' })
  })

  it('pedido sem recipient_id (forma antiga): sem linha a reservar, e o 5xx também volta incerto', async () => {
    enviarModelo.mockRejectedValue(new MetaApiError('boom', { httpStatus: 500 }))
    const corpo = await lote([{ phone: r1.phone, params: [] }])
    expect(updates).toEqual([])
    expect(corpo.results).toEqual([{ phone: r1.phone, status: 'uncertain', error: 'boom' }])
  })
})
