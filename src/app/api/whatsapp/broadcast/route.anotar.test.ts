import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A rota do lote do disparo pela tela ANOTA o envio na linha do
// destinatário na hora em que a Meta o aceita.
//
// Antes o wamid só chegava a `broadcast_recipients` quando o lote de 10
// voltava ao navegador, e o recibo da Meta que chegasse antes disso ficava
// sem destinatário: esperava os 7 s da rota do webhook e se perdia. O teste
// cobra a ORDEM (anotar o 1º antes de mandar o 2º) e as cercas da escrita.
// ============================================================

const eventos: string[] = []
const updates: { patch: Record<string, unknown>; filtros: [string, unknown][] }[] = []
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
          async select() {
            updates.push({ patch, filtros })
            eventos.push(`anotou ${String(filtros.find(([c]) => c === 'id')?.[1])}`)
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
const falharPara = new Set<string>()
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn(async ({ to }: { to: string }) => {
    eventos.push(`enviou ${to}`)
    if (falharPara.has(to)) throw new Error('(#131026) Message undeliverable')
    return { messageId: `wamid.${to}` }
  }),
}))

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
  it('anota cada destinatário logo depois do SEU envio, antes do próximo', async () => {
    const results = await enviar([
      { recipient_id: 'r1', phone: '5583988745316', params: [] },
      { recipient_id: 'r2', phone: '5583988745317', params: [] },
    ])
    expect(eventos).toEqual([
      'enviou 5583988745316',
      'anotou r1',
      'enviou 5583988745317',
      'anotou r2',
    ])
    expect(results).toEqual([
      expect.objectContaining({ status: 'sent', recipient_id: 'r1', anotado: true, whatsapp_message_id: 'wamid.5583988745316' }),
      expect.objectContaining({ status: 'sent', recipient_id: 'r2', anotado: true }),
    ])
  })

  it('grava sent + wamid + hora, e SÓ em linha ainda pending', async () => {
    await enviar([{ recipient_id: 'r1', phone: '5583988745316', params: [] }])
    expect(updates).toHaveLength(1)
    expect(updates[0].patch).toMatchObject({
      status: 'sent',
      whatsapp_message_id: 'wamid.5583988745316',
      error_message: null,
    })
    expect(typeof updates[0].patch.sent_at).toBe('string')
    expect(updates[0].filtros).toEqual([
      ['id', 'r1'],
      ['status', 'pending'],
    ])
  })

  it('0 linhas ou erro do banco: anotado false, e o envio continua "sent"', async () => {
    resposta.data = []
    const [semLinha] = await enviar([{ recipient_id: 'r1', phone: '5583988745316', params: [] }])
    expect(semLinha).toMatchObject({ status: 'sent', anotado: false })

    resposta.data = null
    resposta.error = { message: 'boom' }
    const [comErro] = await enviar([{ recipient_id: 'r2', phone: '5583988745317', params: [] }])
    expect(comErro).toMatchObject({ status: 'sent', anotado: false })
  })

  it('envio recusado pela Meta não escreve nada, e devolve a linha para o navegador casar', async () => {
    falharPara.add('5583988745316')
    const [r] = await enviar([{ recipient_id: 'r1', phone: '5583988745316', params: [] }])
    expect(updates).toEqual([])
    expect(r).toMatchObject({ status: 'failed', recipient_id: 'r1' })
    expect(r).not.toHaveProperty('anotado')
  })

  it('pedido sem recipient_id (forma antiga) não escreve nada', async () => {
    const [r] = await enviar([{ phone: '5583988745316', params: [] }])
    expect(updates).toEqual([])
    expect(r).toMatchObject({ status: 'sent' })
    expect(r).not.toHaveProperty('anotado')
  })
})
