import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A rota do lote do disparo pela tela ANOTA o envio na linha do
// destinatário na hora em que a Meta o aceita.
//
// Antes o wamid só chegava a `broadcast_recipients` quando o lote de 10
// voltava ao navegador, e o recibo da Meta que chegasse antes disso ficava
// sem destinatário: esperava os 7 s da rota do webhook e se perdia. O teste
// cobra a ORDEM (anotar o 1º antes de mandar o 2º) e as cercas da escrita —
// desde a 1151, a cerca é a RESERVA da própria rota (`uncertain`).
// ============================================================

type Update = { patch: Record<string, unknown>; filtros: [string, unknown][] }

const eventos: string[] = []
const updates: Update[] = []
/** A resposta do UPDATE do desfecho (a reserva sempre casa aqui). */
const resposta = { data: [{ id: 'x' }] as unknown[] | null, error: null as unknown }

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
            if (patch.status === 'uncertain') {
              eventos.push(`reservou ${id}`)
              return { data: [{ id }], error: null }
            }
            eventos.push(`anotou ${id}`)
            return resposta
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
    accessToken: 'tok',
  })),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({ malformed: false, row: null, language: 'pt_BR' })),
}))
const falharPara = new Map<string, unknown>()
vi.mock('@/lib/whatsapp/meta-api', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/meta-api')>()),
  sendTemplateMessage: vi.fn(async ({ to }: { to: string }) => {
    eventos.push(`enviou ${to}`)
    if (falharPara.has(to)) throw falharPara.get(to)
    return { messageId: `wamid.${to}` }
  }),
}))

import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { POST } from './route'

type Corpo = { results: Record<string, unknown>[] }
const enviar = async (recipients: Record<string, unknown>[]) => {
  const res = (await POST(
    new Request('http://localhost/api/whatsapp/broadcast', {
      method: 'POST',
      body: JSON.stringify({ recipients, template_name: 'modelo', template_language: 'pt_BR' }),
    }),
  )) as unknown as { body: Corpo }
  return res.body.results
}

beforeEach(() => {
  eventos.length = 0
  updates.length = 0
  falharPara.clear()
  resposta.data = [{ id: 'x' }]
  resposta.error = null
})

describe('POST /api/whatsapp/broadcast — anotar o envio na hora', () => {
  it('reserva e anota cada destinatário em volta do SEU envio, antes do próximo', async () => {
    const results = await enviar([
      { recipient_id: 'r1', phone: '5583980000016', params: [] },
      { recipient_id: 'r2', phone: '5583980000017', params: [] },
    ])
    expect(eventos).toEqual([
      'reservou r1',
      'enviou 5583980000016',
      'anotou r1',
      'reservou r2',
      'enviou 5583980000017',
      'anotou r2',
    ])
    expect(results).toEqual([
      expect.objectContaining({ status: 'sent', recipient_id: 'r1', anotado: true, whatsapp_message_id: 'wamid.5583980000016' }),
      expect.objectContaining({ status: 'sent', recipient_id: 'r2', anotado: true }),
    ])
  })

  it('grava sent + wamid + hora, e SÓ na linha que ESTA rota reservou (`uncertain`)', async () => {
    await enviar([{ recipient_id: 'r1', phone: '5583980000016', params: [] }])
    expect(updates).toHaveLength(2)
    expect(updates[0]).toEqual({
      patch: { status: 'uncertain', error_message: null },
      filtros: [
        ['id', 'r1'],
        ['status in', ['pending']],
      ],
    })
    expect(updates[1].patch).toMatchObject({
      status: 'sent',
      whatsapp_message_id: 'wamid.5583980000016',
      error_message: null,
    })
    expect(typeof updates[1].patch.sent_at).toBe('string')
    expect(updates[1].filtros).toEqual([
      ['id', 'r1'],
      ['status', 'uncertain'],
    ])
  })

  it('0 linhas ou erro do banco: anotado false, e o envio continua "sent"', async () => {
    resposta.data = []
    const [semLinha] = await enviar([{ recipient_id: 'r1', phone: '5583980000016', params: [] }])
    expect(semLinha).toMatchObject({ status: 'sent', anotado: false })

    resposta.data = null
    resposta.error = { message: 'boom' }
    const [comErro] = await enviar([{ recipient_id: 'r2', phone: '5583980000017', params: [] }])
    expect(comErro).toMatchObject({ status: 'sent', anotado: false })
  })

  it('recusa COMPROVADA da Meta (4xx): a rota grava `failed` na linha que reservou', async () => {
    falharPara.set(
      '5583980000016',
      new MetaApiError('(#131026) Message undeliverable', { httpStatus: 400, code: 131026 }),
    )
    const [r] = await enviar([{ recipient_id: 'r1', phone: '5583980000016', params: [] }])
    expect(r).toMatchObject({ status: 'failed', recipient_id: 'r1', anotado: true })
    expect(updates[1]).toEqual({
      patch: { status: 'failed', error_message: '(#131026) Message undeliverable' },
      filtros: [
        ['id', 'r1'],
        ['status', 'uncertain'],
      ],
    })
  })

  it('pedido sem recipient_id (forma antiga) não escreve nada', async () => {
    const [r] = await enviar([{ phone: '5583980000016', params: [] }])
    expect(updates).toEqual([])
    expect(r).toMatchObject({ status: 'sent' })
    expect(r).not.toHaveProperty('anotado')
  })
})
