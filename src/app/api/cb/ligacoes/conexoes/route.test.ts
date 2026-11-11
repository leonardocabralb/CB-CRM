import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// As rotas da seção "Ligações pelo CRM" da tela Conexões (4e, 1137): a lista,
// o interruptor, o QR ao vivo e o Reparear. A lógica é de `operacao.ts`
// (testada lá); aqui, o papel, a entrada e o que vira status. Dados fictícios.
// ============================================================

const estado = vi.hoisted(() => ({
  papeis: [] as string[],
  segredo: 'x'.repeat(40) as string | null,
  chamadas: [] as unknown[][],
  resposta: { ok: true } as Record<string, unknown>,
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async (papel: string) => {
    estado.papeis.push(papel)
    return { accountId: 'conta-1', userId: 'u1' }
  },
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/whatsapp/ligacoes/computador', () => ({ segredoDoCrm: () => estado.segredo }))
vi.mock('@/lib/whatsapp/ligacoes/operacao', () => {
  const registrar =
    (nome: string) =>
    async (...args: unknown[]) => {
      estado.chamadas.push([nome, ...args.slice(1)])
      return estado.resposta
    }
  return {
    computadoresDaConta: registrar('lista'),
    trocarInterruptor: registrar('interruptor'),
    qrDaConexao: registrar('qr'),
    reparearConexao: registrar('reparear'),
  }
})

import { GET as lista } from './route'
import { PATCH as interruptor } from './[canal]/route'
import { GET as qr } from './[canal]/qr/route'
import { POST as reparear } from './[canal]/reparear/route'

const CANAL = '00000000-0000-4000-8000-0000000000C1'
const params = (canal = CANAL) => ({ params: Promise.resolve({ canal }) })
const pedido = (corpo?: unknown) =>
  new Request('http://crm.test/x', { method: 'PATCH', body: corpo === undefined ? undefined : JSON.stringify(corpo) })

beforeEach(() => {
  estado.papeis = []
  estado.segredo = 'x'.repeat(40)
  estado.chamadas = []
  estado.resposta = { ok: true }
})

describe('as rotas do admin', () => {
  it('todas exigem ADMIN', async () => {
    estado.resposta = [] as never
    await lista()
    estado.resposta = { ok: true, ligado_em: null }
    await interruptor(pedido({ ligado: false }), params())
    estado.resposta = { ok: true, whatsapp: 'conectado', qr: null }
    await qr(new Request('http://crm.test/x'), params())
    estado.resposta = { ok: true }
    await reparear(new Request('http://crm.test/x', { method: 'POST' }), params())
    expect(estado.papeis).toEqual(['admin', 'admin', 'admin', 'admin'])
  })

  it('a conexão no caminho é um UUID (minúsculo daí em diante)', async () => {
    expect((await qr(new Request('http://crm.test/x'), params('../x'))).status).toBe(400)
    expect((await interruptor(pedido({ ligado: true }), params('nao-e-uuid'))).status).toBe(400)
    estado.resposta = { ok: true, ligado_em: '2026-11-11T15:00:00.000Z' }
    await interruptor(pedido({ ligado: true }), params())
    expect(estado.chamadas[0][2]).toBe(CANAL.toLowerCase())
  })

  it('o interruptor só aceita booleano de verdade', async () => {
    for (const corpo of [{ ligado: 'true' }, { ligado: 1 }, {}, undefined]) {
      expect((await interruptor(pedido(corpo), params())).status).toBe(400)
    }
    expect(estado.chamadas).toHaveLength(0)
    estado.resposta = { ok: true, ligado_em: '2026-11-11T15:00:00.000Z' }
    const r = await interruptor(pedido({ ligado: true }), params())
    expect(await r.json()).toEqual({ ligado: true, ligado_em: '2026-11-11T15:00:00.000Z' })
  })

  it('a recusa da operação vira o status dela', async () => {
    estado.resposta = { ok: false, status: 409, erro: 'em_ligacao' }
    const r = await reparear(new Request('http://crm.test/x', { method: 'POST' }), params())
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'em_ligacao' })
  })

  it('sem o segredo das ligações a instalação não liga: a lista diz, o QR e o Reparear recusam', async () => {
    estado.segredo = null
    expect(await (await lista()).json()).toEqual({ configurado: false, computadores: [] })
    expect((await qr(new Request('http://crm.test/x'), params())).status).toBe(404)
    expect((await reparear(new Request('http://crm.test/x', { method: 'POST' }), params())).status).toBe(404)
    expect(estado.chamadas).toHaveLength(0)
  })

  it('a lista que falhou é 500, nunca vazia', async () => {
    estado.resposta = 'falhou' as never
    expect((await lista()).status).toBe(500)
  })
})
