import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/ia/agentes/[id]/ferramentas/opcoes — o catálogo das ferramentas
// (F4, só admin): o SERVIDOR decide o que não pode ser liberado; a tela só
// mostra. Agente de outra conta = 404; leitura que falha = 500, nunca um
// catálogo pela metade.

const ID = '11111111-1111-4111-8111-111111111111'

let agenteDaConta: unknown
vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/ia-agentes/repo', () => ({
  obterAgente: vi.fn(async () => agenteDaConta),
  ErroDoAgente: class extends Error {},
}))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({ banco: true }) }))
vi.mock('@/lib/ia-agentes/ferramentas', () => ({ lerCatalogoDeFerramentas: vi.fn() }))

import { requireRole } from '@/lib/auth/account'
import { lerCatalogoDeFerramentas } from '@/lib/ia-agentes/ferramentas'
import { GET } from './route'

const chamar = (id = ID) => GET(new Request('http://x'), { params: Promise.resolve({ id }) })

const CATALOGO = {
  etapas: [{ id: 'e1', nome: 'Proposta', funil: 'Bancário', resultado: null, foraDaD5: 'send_webhook' }],
  etiquetas: [{ id: 't1', nome: 'VIP', foraDaD5: { etiquetar: null, tirar: null } }],
  campos: [{ id: 'c1', nome: 'Data da reunião', vigiado: true, tipo: 'datetime', opcoes: [] }],
  membros: [{ userId: 'u1', nome: 'Ana' }],
  automacoes: [{ id: 'a1', nome: 'Aciona filha', foraDaD5: 'aguardar' }],
}

beforeEach(() => {
  agenteDaConta = { id: ID, arquivadoEm: null }
  vi.mocked(lerCatalogoDeFerramentas).mockReset().mockResolvedValue(CATALOGO as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('GET /api/cb/ia/agentes/[id]/ferramentas/opcoes', () => {
  it('o catálogo da CONTA de quem pede (só admin)', async () => {
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(requireRole).toHaveBeenCalledWith('admin')
    expect(await res.json()).toEqual(CATALOGO)
    expect(vi.mocked(lerCatalogoDeFerramentas).mock.calls[0][1]).toBe('conta-1')
  })

  it('agente de outra conta, arquivado ou id que não é uuid: 404, sem ler o catálogo', async () => {
    agenteDaConta = null
    expect((await chamar()).status).toBe(404)
    agenteDaConta = { id: ID, arquivadoEm: '2026-09-01T00:00:00Z' }
    expect((await chamar()).status).toBe(404)
    expect((await chamar('triagem')).status).toBe(404)
    expect(lerCatalogoDeFerramentas).not.toHaveBeenCalled()
  })

  it('leitura que falha: 500', async () => {
    vi.mocked(lerCatalogoDeFerramentas).mockRejectedValueOnce(new Error('timeout'))
    const res = await chamar()
    expect(res.status).toBe(500)
    expect((await res.json()).code).toBe('banco')
  })
})
