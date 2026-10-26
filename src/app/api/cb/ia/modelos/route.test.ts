import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/ia/modelos — os modelos das três chaves numa chamada, quem lê a
// mídia sobre as MESMAS leituras de chave, e nenhuma chave na resposta.

const requireRole = vi.fn(async (papel: string) => ({ accountId: 'conta-1', userId: 'user-1', papel }))
vi.mock('@/lib/auth/account', () => ({
  requireRole: (papel: string) => requireRole(papel),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))
const modelosDaConta = vi.fn()
vi.mock('@/lib/ai/modelos-da-chave', () => ({
  modelosDaConta: (...a: unknown[]) => modelosDaConta(...a),
}))
vi.mock('@/lib/ia-chaves/repo', () => ({ PROVEDORES: ['gemini', 'openai', 'anthropic'] }))

import { GET } from './route'

type Lido = { modelos: unknown; leAMidia: boolean | null }
let porProvedor: Record<string, Lido> = {}

beforeEach(() => {
  requireRole.mockClear()
  modelosDaConta.mockReset()
  porProvedor = {
    gemini: { modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false },
    openai: { modelos: { ok: false, motivo: 'falhou', codigo: 'timeout' }, leAMidia: true },
    anthropic: { modelos: { ok: true, modelos: [{ id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5' }] }, leAMidia: true },
  }
  modelosDaConta.mockImplementation(async (_conta: string, p: string) => porProvedor[p])
})

describe('GET /api/cb/ia/modelos', () => {
  it('só administrador; os três provedores, cada um com a lista ou o motivo', async () => {
    const res = await GET(new Request('http://x/api/cb/ia/modelos'))
    expect(requireRole).toHaveBeenCalledWith('admin')
    expect(res.status).toBe(200)
    const corpo = (await res.json()) as { provedores: Record<string, unknown> }
    expect(corpo.provedores).toEqual({
      gemini: { ok: false, motivo: 'sem_chave' },
      openai: { ok: false, motivo: 'falhou', codigo: 'timeout' },
      anthropic: { ok: true, modelos: [{ id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5' }] },
    })
    expect(modelosDaConta.mock.calls.map((c) => c[0])).toEqual(['conta-1', 'conta-1', 'conta-1'])
  })

  it('?atualizar=1 passa adiante (fura o cache); sem ele, não', async () => {
    await GET(new Request('http://x/api/cb/ia/modelos'))
    expect(modelosDaConta.mock.calls.every((c) => (c[2] as { atualizar: boolean }).atualizar === false)).toBe(true)
    modelosDaConta.mockClear()
    await GET(new Request('http://x/api/cb/ia/modelos?atualizar=1'))
    expect(modelosDaConta.mock.calls.every((c) => (c[2] as { atualizar: boolean }).atualizar === true)).toBe(true)
  })

  it('quem lê a mídia: a primeira chave que lê, na ordem de cada módulo (a lista que falhou não tira a vez)', async () => {
    const corpo = (await (await GET(new Request('http://x/api/cb/ia/modelos'))).json()) as { leitores: unknown }
    expect(corpo.leitores).toEqual({ audio: 'openai', imagemEPdf: 'openai' })
  })

  it('só a Anthropic lê: ninguém ouve o áudio', async () => {
    porProvedor.openai = { modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false }
    const corpo = (await (await GET(new Request('http://x/api/cb/ia/modelos'))).json()) as { leitores: unknown }
    expect(corpo.leitores).toEqual({ audio: null, imagemEPdf: 'anthropic' })
  })

  it('a leitura de uma chave falhou: quem lê fica DESCONHECIDO (null), nunca "ninguém"', async () => {
    porProvedor.gemini = { modelos: { ok: false, motivo: 'falhou', codigo: 'leitura_falhou' }, leAMidia: null }
    const corpo = (await (await GET(new Request('http://x/api/cb/ia/modelos'))).json()) as { leitores: unknown }
    expect(corpo.leitores).toBeNull()
  })
})
