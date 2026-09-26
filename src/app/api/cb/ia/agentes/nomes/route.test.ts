import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/ia/agentes/nomes — o nome dos agentes para QUALQUER membro (a
// bolha "IA · nome" e a faixa do fio): a tabela só dá SELECT ao admin (D14).
// Só id e nome saem; arquivados inclusive (mensagem antiga mantém o nome).

let linhas: unknown[] | null = []
let erro: { message: string } | null = null
const consultas: { colunas: string; filtros: Array<[string, unknown]> }[] = []

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1', role: 'viewer' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 401 })),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: (colunas: string) => {
        const c = { colunas, filtros: [] as Array<[string, unknown]> }
        consultas.push(c)
        return {
          eq: async (col: string, v: unknown) => {
            c.filtros.push([col, v])
            return { data: linhas, error: erro }
          },
        }
      },
    }),
  }),
}))

import { getCurrentAccount } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  linhas = []
  erro = null
  consultas.length = 0
})

describe('GET /api/cb/ia/agentes/nomes', () => {
  it('qualquer membro (sem requireRole): id e nome, da conta da sessão, arquivados inclusive', async () => {
    linhas = [
      { id: 'ag-1', nome: 'Triagem' },
      { id: 'ag-2', nome: 'Cobrança (arquivado)' },
    ]
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      agentes: [
        { id: 'ag-1', nome: 'Triagem' },
        { id: 'ag-2', nome: 'Cobrança (arquivado)' },
      ],
    })
    expect(getCurrentAccount).toHaveBeenCalled()
    expect(consultas[0].colunas).toBe('id, nome')
    expect(consultas[0].filtros).toEqual([['account_id', 'conta-1']])
  })

  it('erro de banco é 500, nunca lista vazia', async () => {
    erro = { message: 'timeout' }
    const res = await GET()
    expect(res.status).toBe(500)
  })
})
