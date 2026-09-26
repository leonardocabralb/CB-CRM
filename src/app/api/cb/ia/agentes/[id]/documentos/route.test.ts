import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// /api/cb/ia/agentes/[id]/documentos — a base de conhecimento do agente (F3,
// D20). Só administrador (D14); a lista é INTEIRA; documento que não é da
// conta = 400 `documento_invalido`; agente arquivado ou de outra conta = 404.
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'
const DOC = '44444444-4444-4444-8444-444444444444'

let papelRecusado = false
let agente: Record<string, unknown> | null

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    if (papelRecusado) throw Object.assign(new Error('Forbidden'), { status: 403 })
    return { accountId: 'conta-1', userId: 'user-1' }
  }),
  toErrorResponse: vi.fn((err: { status?: number }) => new Response('erro', { status: err.status ?? 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ia-agentes/repo', async () => {
  const { ErroDoAgente } = await vi.importActual<typeof import('@/lib/ia-agentes/repo')>('@/lib/ia-agentes/repo')
  return {
    ErroDoAgente,
    obterAgente: vi.fn(async () => agente),
    lerDocumentosDoAgente: vi.fn(async () => [DOC]),
    gravarDocumentosDoAgente: vi.fn(async (_c: string, _a: string, ids: string[]) => ids),
  }
})

import { requireRole } from '@/lib/auth/account'
import { ErroDoAgente, gravarDocumentosDoAgente, lerDocumentosDoAgente } from '@/lib/ia-agentes/repo'
import { GET, PUT } from './route'

const ctx = { params: Promise.resolve({ id: ID }) }
const put = (corpo: unknown) =>
  PUT(new Request(`http://x/api/cb/ia/agentes/${ID}/documentos`, { method: 'PUT', body: JSON.stringify(corpo) }), ctx)

beforeEach(() => {
  papelRecusado = false
  agente = { id: ID, arquivadoEm: null }
  vi.mocked(gravarDocumentosDoAgente).mockClear()
  vi.mocked(lerDocumentosDoAgente).mockClear()
})

describe('GET …/documentos', () => {
  it('os documentos marcados para o agente', async () => {
    const res = await GET(new Request('http://x'), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ documentoIds: [DOC] })
    expect(requireRole).toHaveBeenCalledWith('admin')
    expect(lerDocumentosDoAgente).toHaveBeenCalledWith('conta-1', ID)
  })

  it('agente arquivado ou de outra conta: 404, sem ler a base', async () => {
    agente = { id: ID, arquivadoEm: '2026-09-01T00:00:00Z' }
    expect((await GET(new Request('http://x'), ctx)).status).toBe(404)
    agente = null
    expect((await GET(new Request('http://x'), ctx)).status).toBe(404)
    expect(lerDocumentosDoAgente).not.toHaveBeenCalled()
  })

  it('só administrador', async () => {
    papelRecusado = true
    expect((await GET(new Request('http://x'), ctx)).status).toBe(403)
  })
})

describe('PUT …/documentos', () => {
  it('grava a lista inteira e devolve o que ficou gravado', async () => {
    const res = await put({ documentoIds: [DOC, DOC] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ documentoIds: [DOC] })
    expect(gravarDocumentosDoAgente).toHaveBeenCalledWith('conta-1', ID, [DOC])
  })

  it('lista vazia = nenhuma base (vale)', async () => {
    const res = await put({ documentoIds: [] })
    expect(res.status).toBe(200)
    expect(gravarDocumentosDoAgente).toHaveBeenCalledWith('conta-1', ID, [])
  })

  it('corpo fora da forma: 400 lista_invalida, sem gravar', async () => {
    for (const corpo of [{}, { documentoIds: 'x' }, { documentoIds: ['faq'] }]) {
      const res = await put(corpo)
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('lista_invalida')
    }
    expect(gravarDocumentosDoAgente).not.toHaveBeenCalled()
  })

  it('documento que não é da conta: 400 documento_invalido', async () => {
    vi.mocked(gravarDocumentosDoAgente).mockRejectedValueOnce(new ErroDoAgente('documento_invalido', 'x'))
    const res = await put({ documentoIds: [DOC] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'documento_invalido', code: 'documento_invalido' })
  })

  it('agente arquivado: 404', async () => {
    vi.mocked(gravarDocumentosDoAgente).mockRejectedValueOnce(new ErroDoAgente('nao_encontrado', 'x'))
    expect((await put({ documentoIds: [DOC] })).status).toBe(404)
  })

  it('erro de banco: 500, nunca "gravado"', async () => {
    vi.mocked(gravarDocumentosDoAgente).mockRejectedValueOnce(new ErroDoAgente('banco', 'timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await put({ documentoIds: [DOC] })).status).toBe(500)
  })
})
