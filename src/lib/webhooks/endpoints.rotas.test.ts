import { beforeEach, describe, expect, it, vi } from 'vitest'

// Porte do #681: URL de webhook de saída com usuário e senha é recusada no
// CADASTRO, nas QUATRO portas que gravam `webhook_endpoints.url` — as duas da
// API v1 (chave `webhooks:manage`) e as duas de sessão que a tela de
// Configurações → Webhooks → Enviados usa. Cada porta recusa ANTES do banco: o
// banco destes testes estoura se for tocado.
//
// A v1 responde a frase do original (inglês, contrato da API); a de sessão
// responde o CÓDIGO, que a tela traduz (`Settings.webhooks.urlComCredencial`).

const { idasAoBanco, bancoQueNaoDeviaSerUsado } = vi.hoisted(() => {
  const idasAoBanco: string[] = []
  return {
    idasAoBanco,
    bancoQueNaoDeviaSerUsado: {
      from(tabela: string) {
        idasAoBanco.push(tabela)
        throw new Error(`a recusa devia vir antes do banco (${tabela})`)
      },
    },
  }
})

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(async () => ({
    supabase: bancoQueNaoDeviaSerUsado,
    accountId: 'conta-1',
    createdBy: 'autor-1',
  })),
}))
vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ userId: 'admin-1', accountId: 'conta-1' })),
  toErrorResponse: (err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => bancoQueNaoDeviaSerUsado,
}))

import { POST as criarPelaApi } from '@/app/api/v1/webhooks/route'
import { PATCH as editarPelaApi } from '@/app/api/v1/webhooks/[id]/route'
import { POST as criarPelaTela } from '@/app/api/cb/webhooks-de-saida/route'
import { PATCH as editarPelaTela } from '@/app/api/cb/webhooks-de-saida/[id]/route'

const ID = '11111111-1111-4111-8111-111111111111'
const params = { params: Promise.resolve({ id: ID }) }

const pedido = (metodo: 'POST' | 'PATCH', corpo: unknown) =>
  new Request('http://localhost/x', {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })

const COM_CREDENCIAL = 'https://usuario:senha@exemplo.invalid/aviso'
const EVENTOS = ['message.received']

beforeEach(() => {
  idasAoBanco.length = 0
})

describe('URL de webhook com usuário e senha: as quatro portas recusam antes do banco', () => {
  it('API v1, POST e PATCH: 400 bad_request com a frase do segredo de assinatura', async () => {
    const respostas = [
      await criarPelaApi(pedido('POST', { url: COM_CREDENCIAL, events: EVENTOS })),
      await editarPelaApi(pedido('PATCH', { url: COM_CREDENCIAL }), params),
    ]
    for (const res of respostas) {
      expect(res.status).toBe(400)
      const corpo = await res.json()
      expect(corpo.error.code).toBe('bad_request')
      expect(corpo.error.message).toMatch(/username or password/)
      expect(corpo.error.message).toMatch(/signing secret/)
    }
    expect(idasAoBanco).toEqual([])
  })

  it('sessão (a tela), POST e PATCH: 400 com o código `url_com_credencial`', async () => {
    const respostas = [
      await criarPelaTela(pedido('POST', { url: COM_CREDENCIAL, events: EVENTOS })),
      await editarPelaTela(pedido('PATCH', { url: COM_CREDENCIAL }), params),
    ]
    for (const res of respostas) {
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'url_com_credencial' })
    }
    expect(idasAoBanco).toEqual([])
  })

  it('o `http://` continua com a resposta de antes em cada porta', async () => {
    const http = 'http://exemplo.invalid/aviso'

    const v1 = await criarPelaApi(pedido('POST', { url: http, events: EVENTOS }))
    expect(v1.status).toBe(400)
    expect((await v1.json()).error.message).toBe("'url' must be a valid https:// URL")

    const tela = await criarPelaTela(pedido('POST', { url: http, events: EVENTOS }))
    expect(tela.status).toBe(400)
    expect(await tela.json()).toEqual({ error: 'url_invalida' })

    expect(idasAoBanco).toEqual([])
  })
})
