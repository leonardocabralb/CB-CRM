import { beforeEach, describe, expect, it, vi } from 'vitest'

// gravarChave — a chave "própria" dos embeddings que a 1047 copiou comparando
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
const legados: Record<string, unknown>[] = []

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
      return {
        update: (campos: Record<string, unknown>) => {
          legados.push(campos)
          return eq
        },
      }
    },
  }),
}))

import { gravarChave } from './repo'

beforeEach(() => {
  upserts.length = 0
  legados.length = 0
  linhaOpenai = null
})

describe('gravarChave — a chave própria falsa dos embeddings sai na troca', () => {
  it('a "própria" que decifra IGUAL à do chat é apagada', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'cifra:91:sk-velha' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', null)
    expect(upserts[0]).toHaveProperty('embeddings_api_key', null)
    // E a cópia legada sai junto (a volta atrás do deploy não a usaria).
    expect(legados).toContainEqual({ embeddings_api_key: null })
  })

  it('a própria DIFERENTE fica (o upsert não toca a coluna)', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'cifra:91:sk-dos-embeddings' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', null)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
    expect(legados).not.toContainEqual({ embeddings_api_key: null })
  })

  it('a chave que era SÓ da base (mesmo texto cifrado nos dois campos, a marca da 1047) fica', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-da-base', embeddings_api_key: 'cifra:90:sk-da-base' }
    await gravarChave('conta-1', 'openai', 'sk-de-chat', 'user-1', false)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
    expect(legados).not.toContainEqual({ embeddings_api_key: null })
  })

  it('chave que não decifra: na dúvida, não apaga', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-velha', embeddings_api_key: 'lixo' }
    await gravarChave('conta-1', 'openai', 'sk-nova', 'user-1', false)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })

  it('a própria igual à chave NOVA sai — o veredito da gravação passa a valer (Codex, #295)', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-a', embeddings_api_key: 'cifra:91:sk-b' }
    await gravarChave('conta-1', 'openai', 'sk-b', 'user-1', false)
    expect(upserts[0]).toHaveProperty('embeddings_api_key', null)
    expect(upserts[0]).toHaveProperty('serve_embeddings', false)
  })

  it('a chave que era SÓ da base e é a MESMA da nova também sai (a linha passa a ser do chat)', async () => {
    linhaOpenai = { api_key: 'cifra:90:sk-da-base', embeddings_api_key: 'cifra:90:sk-da-base' }
    await gravarChave('conta-1', 'openai', 'sk-da-base', 'user-1', false)
    expect(upserts[0]).toHaveProperty('embeddings_api_key', null)
  })

  it('outro provedor não consulta nada da OpenAI', async () => {
    linhaOpenai = { api_key: 'cifra:90:x', embeddings_api_key: 'cifra:91:x' }
    await gravarChave('conta-1', 'gemini', 'g-nova', 'user-1', null)
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })
})

describe('gravarChave — a chave que só gera embedding leva a MARCA de só da base (Codex, #295)', () => {
  it('o MESMO texto cifrado nas duas colunas (é o que tira a chave da escolha do chat)', async () => {
    await gravarChave('conta-1', 'openai', 'sk-restrita', 'user-1', true, { soDaBase: true })
    expect(upserts[0].api_key).toMatch(/sk-restrita$/)
    expect(upserts[0].embeddings_api_key).toBe(upserts[0].api_key)
  })

  it('sem a marca, a chave que serve às duas coisas não fica só da base', async () => {
    await gravarChave('conta-1', 'openai', 'sk-comum', 'user-1', true, { soDaBase: false })
    expect(upserts[0]).toHaveProperty('embeddings_api_key', null)
  })

  it('a marca não vale fora da OpenAI', async () => {
    await gravarChave('conta-1', 'gemini', 'g-nova', 'user-1', null, { soDaBase: true })
    expect(upserts[0]).not.toHaveProperty('embeddings_api_key')
  })
})
