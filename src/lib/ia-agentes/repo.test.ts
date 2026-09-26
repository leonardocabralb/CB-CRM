import { beforeEach, describe, expect, it, vi } from 'vitest'

// criarAgente / atualizarAgente — o provedor ESCOLHIDO precisa de uma chave
// que sirva ao CHAT. A chave da OpenAI que nasceu SÓ da base (1047) pode ser
// restrita aos embeddings: o agente nasceria mudo (Codex, #295).

let estado: { provedor: string; existe: boolean; soDaBase: boolean }[] = []
const inserts: Record<string, unknown>[] = []

vi.mock('@/lib/ia-chaves/repo', () => ({ lerEstado: vi.fn(async () => estado) }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (linha: Record<string, unknown>) => {
        inserts.push(linha)
        return { select: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'parou aqui' } }) }) }
      },
    }),
  }),
}))

import { criarAgente } from './repo'

beforeEach(() => {
  inserts.length = 0
  estado = [
    { provedor: 'gemini', existe: true, soDaBase: false },
    { provedor: 'openai', existe: true, soDaBase: true },
    { provedor: 'anthropic', existe: false, soDaBase: false },
  ]
})

describe('criarAgente — a chave do provedor tem de servir ao chat', () => {
  it('OpenAI só da base: recusa com código próprio, nada gravado', async () => {
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'openai' } as never)).rejects.toMatchObject({
      codigo: 'provedor_so_da_base',
    })
    expect(inserts).toHaveLength(0)
  })

  it('provedor sem chave: provedor_sem_chave', async () => {
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'anthropic' } as never)).rejects.toMatchObject({
      codigo: 'provedor_sem_chave',
    })
  })

  it('OpenAI com chave de chat (não só da base): passa da conferência', async () => {
    estado[1] = { provedor: 'openai', existe: true, soDaBase: false }
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'openai' } as never)).rejects.toMatchObject({
      codigo: 'banco',
    })
    expect(inserts).toHaveLength(1)
  })
})
