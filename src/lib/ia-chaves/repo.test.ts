import { beforeEach, describe, expect, it, vi } from 'vitest'

// gravarChave — a chave "própria" dos embeddings que a 1042 copiou comparando
// textos CIFRADOS (IV aleatório) pode ser a MESMA do chat. Na troca, ela sai;
// senão continuaria sendo usada depois de a chave velha ser revogada (Codex,
// #294). A cifra dos testes imita a real: aleatória, reversível.

let sorteio = 0
vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: (x: string) => `cifra:${sorteio++}:${x}`,
  decrypt: (x: string) => {
    const m = /^cifra:\d+:(.*)$/.exec(x)
    if (!m) throw new Error('não decifra')
    return m[1]
  },
}))

let linhaOpenai: { api_key: string; embeddings_api_key: string | null } | null = null
const upserts: Record<string, unknown>[] = []

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela === 'cb_ia_chaves') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: linhaOpenai, error: null }) }),
            }),
          }),
          upsert: async (linha: Record<string, unknown>) => {
            upserts.push(linha)
            return { error: null }
          },
        }
      }
      // ai_configs (o espelho legado): aceita tudo.
      const fim = { error: null }
      const eq: Record<string, unknown> = {}
      eq.eq = () => eq
      eq.is = async () => fim
      eq.then = (r: (v: unknown) => unknown) => r(fim)
      return { update: () => eq }
    },
  }),
}))

import { gravarChave } from './repo'

beforeEach(() => {
  upserts.length = 0
  linhaOpenai = null
})

describe('gravarChave — a chave própria falsa dos embeddings sai na troca', () => {
  it('a "própria" que decifra IGUAL à do chat é apagada', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'cifra:91:sk-velha' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', null)
    expect(upserts[0]).toHaveProperty('embeddings_api_key', null)
  })

  it('a própria DIFERENTE fica (o upsert não toca a coluna)', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'cifra:91:sk-dos-embeddings' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', null)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })

  it('chave que não decifra: na dúvida, não apaga', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'lixo' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', false)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })

  it('outro provedor não consulta nada da OpenAI', async () => {
    linhaOpenai = { api_key: 'cifra:90:x', embeddings_api_key: 'cifra:91:x' }
    await gravarChave('conta-1', 'gemini', 'g-nova', 'user-1', null)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })
})
