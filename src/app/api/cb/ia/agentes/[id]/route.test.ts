import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// /api/cb/ia/agentes/[id] — o agente vem com as ETAPAS em que atua (D24), e o
// PATCH que marca etapa de OUTRO agente volta 409 `etapa_ocupada` com o nome
// dele (a tela o diz). Tudo de agentes é só admin (D14).
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'

let papelRecusado = false

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

const etapa = { stageId: 'e1', pipelineId: 'f1', desde: '2026-09-26T10:00:00Z' }
const acesso = { ficha: false, campos: [], negocio: true, etiquetas: false, cobrancas: true, reuniao: false }

vi.mock('@/lib/ia-agentes/repo', async () => {
  const { ErroDoAgente } = await vi.importActual<typeof import('@/lib/ia-agentes/repo')>('@/lib/ia-agentes/repo')
  return {
    ErroDoAgente,
    obterAgenteComEtapas: vi.fn(async () => ({ id: ID, nome: 'Triagem', arquivadoEm: null, etapas: [etapa], acesso })),
    etapasDosAgentes: vi.fn(async () => new Map([[ID, [etapa]]])),
    arquivarAgente: vi.fn(),
    atualizarAgente: vi.fn(async () => ({ id: ID, nome: 'Triagem', arquivadoEm: null })),
  }
})

import { requireRole } from '@/lib/auth/account'
import { atualizarAgente, ErroDoAgente } from '@/lib/ia-agentes/repo'
import { GET, PATCH } from './route'

const ctx = { params: Promise.resolve({ id: ID }) }

function patch(corpo: unknown) {
  return PATCH(new Request(`http://x/api/cb/ia/agentes/${ID}`, { method: 'PATCH', body: JSON.stringify(corpo) }), ctx)
}

beforeEach(() => {
  papelRecusado = false
  vi.mocked(atualizarAgente).mockClear()
})

describe('GET /api/cb/ia/agentes/[id]', () => {
  it('traz as etapas em que o agente atua', async () => {
    const res = await GET(new Request('http://x'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).agente.etapas).toEqual([etapa])
  })

  it('só administrador', async () => {
    papelRecusado = true
    const res = await GET(new Request('http://x'), ctx)
    expect(res.status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('admin')
  })
})

describe('PATCH /api/cb/ia/agentes/[id] — etapas', () => {
  it('passa a lista de etapas ao repositório e devolve o agente com as etapas gravadas', async () => {
    const res = await patch({ etapas: ['22222222-2222-4222-8222-222222222222'] })
    expect(res.status).toBe(200)
    expect(vi.mocked(atualizarAgente).mock.calls[0][3]).toEqual({ etapas: ['22222222-2222-4222-8222-222222222222'] })
    expect((await res.json()).agente.etapas).toEqual([etapa])
  })

  it('⚠️ etapa de outro agente: 409 etapa_ocupada com o NOME do outro agente', async () => {
    vi.mocked(atualizarAgente).mockRejectedValueOnce(new ErroDoAgente('etapa_ocupada', 'x', 'Cobrança'))
    const res = await patch({ etapas: ['22222222-2222-4222-8222-222222222222'] })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'etapa_ocupada', outroAgente: 'Cobrança' })
  })

  it('etapa que não é da conta: 400', async () => {
    vi.mocked(atualizarAgente).mockRejectedValueOnce(new ErroDoAgente('etapa_de_outra_conta', 'x'))
    const res = await patch({ etapas: ['22222222-2222-4222-8222-222222222222'] })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('etapa_de_outra_conta')
  })

  it('lista com algo que não é id: 400 sem chamar o repositório', async () => {
    const res = await patch({ etapas: ['lead'] })
    expect(res.status).toBe(400)
    expect(atualizarAgente).not.toHaveBeenCalled()
  })
})

describe('F3 — o acesso do agente', () => {
  const CAMPO = '33333333-3333-4333-8333-333333333333'

  it('GET traz o acesso', async () => {
    const res = await GET(new Request('http://x'), ctx)
    expect((await res.json()).agente.acesso).toEqual(acesso)
  })

  it('PATCH com `acesso`: o objeto lido pela régua (só o booleano true liga) vai ao repositório', async () => {
    const res = await patch({ acesso: { ficha: true, cobrancas: 'true', campos: [CAMPO] } })
    expect(res.status).toBe(200)
    expect(vi.mocked(atualizarAgente).mock.calls[0][3]).toEqual({
      acesso: { ficha: true, campos: [CAMPO], negocio: false, etiquetas: false, cobrancas: false, reuniao: false },
    })
  })

  it('PATCH com campos fora da forma: 400 lista_invalida, sem gravar', async () => {
    const res = await patch({ acesso: { campos: ['telefone'] } })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('lista_invalida')
    expect(atualizarAgente).not.toHaveBeenCalled()
  })
})
