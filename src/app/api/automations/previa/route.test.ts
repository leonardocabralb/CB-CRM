import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A rota da PRÉVIA do seletor de variáveis (29/09/2026): só leitura, só
// admin, e o contato conferido pela CONTA antes de o motor ler qualquer coisa
// — um id de outra conta voltaria "tudo vazio" com cara de certo. Erro de
// leitura é 500, nunca `{}`.
// ============================================================

const CONTATO = '11111111-1111-4111-8111-111111111111'

const h = vi.hoisted(() => ({
  papel: 'admin',
  conta: 'acc-1',
  erroDeLeitura: null as { message: string } | null,
  contatos: [] as Record<string, unknown>[],
  negocios: 1,
  erroNaContagem: null as { message: string } | null,
  filtros: [] as [string, unknown][],
  escritas: 0,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const filtros: [string, unknown][] = []
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (k: string, v: unknown) => {
          filtros.push([k, v])
          h.filtros.push([k, v])
          return b
        },
        update: () => ((h.escritas += 1), b),
        insert: () => ((h.escritas += 1), b),
        delete: () => ((h.escritas += 1), b),
        maybeSingle: async () => {
          if (h.erroDeLeitura) return { data: null, error: h.erroDeLeitura }
          return { data: h.contatos.find((c) => filtros.every(([k, v]) => c[k] === v)) ?? null, error: null }
        },
        // A contagem dos cards (`select` com `head: true`, sem maybeSingle).
        then: (f: (v: unknown) => unknown) =>
          Promise.resolve(
            h.erroNaContagem ? { count: null, error: h.erroNaContagem } : { count: h.negocios, error: null },
          ).then(f),
      }
      return b
    },
  }),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn<(min: string) => Promise<Record<string, unknown>>>(async () => {
    if (h.papel !== 'admin' && h.papel !== 'owner') throw new Error('forbidden')
    return { accountId: h.conta, userId: 'u-1', role: h.papel }
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}))

vi.mock('@/lib/automations/engine', () => ({
  valoresParaPrevia: vi.fn(async () => ({ 'contact.name': { mensagem: 'Marcelo', cru: 'Marcelo' } })),
}))

import { GET } from './route'
import { requireRole } from '@/lib/auth/account'
import { valoresParaPrevia } from '@/lib/automations/engine'

const pedir = (contato: string) => GET(new Request(`http://x/api/automations/previa?contato=${contato}`))

beforeEach(() => {
  h.papel = 'admin'
  h.conta = 'acc-1'
  h.erroDeLeitura = null
  h.filtros = []
  h.escritas = 0
  h.contatos = [{ id: CONTATO, account_id: 'acc-1' }]
  h.negocios = 1
  h.erroNaContagem = null
})

describe('GET /api/automations/previa', () => {
  it('pede ADMIN — a leitura é em service role', async () => {
    await pedir(CONTATO)
    expect(vi.mocked(requireRole)).toHaveBeenCalledWith('admin')
    h.papel = 'agent'
    expect((await pedir(CONTATO)).status).toBe(403)
  })

  it('devolve os valores do motor para o contato da conta', async () => {
    const res = await pedir(CONTATO)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ valores: { 'contact.name': { mensagem: 'Marcelo', cru: 'Marcelo' } }, negocios: 1 })
    expect(vi.mocked(valoresParaPrevia)).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', contactId: CONTATO }),
    )
    expect(h.filtros).toContainEqual(['account_id', 'acc-1'])
  })

  it('contato de OUTRA conta é 404, e o motor nem é chamado', async () => {
    h.contatos = [{ id: CONTATO, account_id: 'outra' }]
    const res = await pedir(CONTATO)
    expect(res.status).toBe(404)
    expect(vi.mocked(valoresParaPrevia)).not.toHaveBeenCalled()
  })

  it('leitura que falha é 500, nunca uma prévia vazia', async () => {
    h.erroDeLeitura = { message: 'fora do ar' }
    expect((await pedir(CONTATO)).status).toBe(500)
    expect(vi.mocked(valoresParaPrevia)).not.toHaveBeenCalled()
  })

  it('leitura do motor que falha (modo estrito) é 500, nunca valores vazios', async () => {
    vi.mocked(valoresParaPrevia).mockRejectedValueOnce(new Error('prévia: leitura do contato falhou: x'))
    const res = await pedir(CONTATO)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db_error' })
  })

  it('devolve quantos cards o cliente tem, e a contagem que falha é 500', async () => {
    h.negocios = 3
    expect((await (await pedir(CONTATO)).json()).negocios).toBe(3)
    h.erroNaContagem = { message: 'fora do ar' }
    expect((await pedir(CONTATO)).status).toBe(500)
  })

  it('id que não é UUID é 400', async () => {
    expect((await pedir('abc')).status).toBe(400)
    expect((await pedir('')).status).toBe(400)
  })

  it('só lê', async () => {
    await pedir(CONTATO)
    expect(h.escritas).toBe(0)
  })
})
