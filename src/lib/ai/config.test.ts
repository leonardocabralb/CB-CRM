import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// A chave vem de `cb_ia_chaves` (1042), pelo PROVEDOR da linha — nunca de
// `ai_configs.api_key`.
const chaves: Record<string, { chave: string | null; ilegivel: boolean }> = {}
// A da OpenAI que a OpenAI RECUSOU para embeddings ao ser gravada.
let recusadaParaEmbeddings = false
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(async (_conta: string, provedor: string) =>
    chaves[provedor] ?? { chave: null, ilegivel: false },
  ),
  lerChaveDeEmbeddings: vi.fn(async () => {
    if (recusadaParaEmbeddings) return { chave: null, ilegivel: false, recusada: true }
    return { ...(chaves.openai ?? { chave: null, ilegivel: false }), recusada: false }
  }),
}))

import { loadAiConfig } from './config'

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
          is: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as SupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  embeddings_api_key: null,
}

beforeEach(() => {
  for (const k of Object.keys(chaves)) delete chaves[k]
  recusadaParaEmbeddings = false
  chaves.openai = { chave: 'chave-openai', ilegivel: false }
})

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('chave-openai')
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})

describe('loadAiConfig — a chave é a do PROVEDOR (1042)', () => {
  it('sem chave para o provedor da linha = IA indisponível (null)', async () => {
    delete chaves.openai
    expect(
      await loadAiConfig(dbReturning(ROW), 'acct', { requireActive: false }),
    ).toBeNull()
  })

  it('embeddings = a chave da OpenAI da conta, mesmo com o chat em outro provedor', async () => {
    chaves.gemini = { chave: 'chave-gemini', ilegivel: false }
    const config = await loadAiConfig(
      dbReturning({ ...ROW, provider: 'gemini' }),
      'acct',
      { requireActive: false },
    )
    expect(config!.apiKey).toBe('chave-gemini')
    expect(config!.embeddingsApiKey).toBe('chave-openai')
  })

  it('chave da OpenAI ilegível só rebaixa a busca da base — não derruba o chat', async () => {
    chaves.gemini = { chave: 'chave-gemini', ilegivel: false }
    chaves.openai = { chave: null, ilegivel: true }
    const config = await loadAiConfig(
      dbReturning({ ...ROW, provider: 'gemini' }),
      'acct',
      { requireActive: false },
    )
    expect(config!.apiKey).toBe('chave-gemini')
    expect(config!.embeddingsApiKey).toBeNull()
  })

  it('chave da OpenAI RECUSADA para embeddings ao gravar: o chat usa a chave, a base não (Codex, #294)', async () => {
    recusadaParaEmbeddings = true
    const config = await loadAiConfig(dbReturning(ROW), 'acct', { requireActive: false })
    expect(config!.apiKey).toBe('chave-openai')
    expect(config!.embeddingsApiKey).toBeNull()
  })
})

describe('loadAiConfig — "não decifra" e "não sei" não viram "não configurado"', () => {
  it('chave ILEGÍVEL lança key_decrypt_failed (o rascunho não diz "configure o assistente")', async () => {
    chaves.openai = { chave: null, ilegivel: true }
    await expect(
      loadAiConfig(dbReturning(ROW), 'acct', { requireActive: false }),
    ).rejects.toMatchObject({ code: 'key_decrypt_failed' })
  })

  it('a leitura da chave de EMBEDDINGS que falha não derruba o chat (Radar, rascunho)', async () => {
    const { lerChaveDeEmbeddings } = await import('@/lib/ia-chaves/repo')
    chaves.gemini = { chave: 'chave-gemini', ilegivel: false }
    vi.mocked(lerChaveDeEmbeddings).mockImplementationOnce(async () => {
      throw new Error('[ia-chaves] leitura falhou: timeout')
    })
    const config = await loadAiConfig(dbReturning({ ...ROW, provider: 'gemini' }), 'acct', {
      requireActive: false,
    })
    expect(config!.apiKey).toBe('chave-gemini')
    expect(config!.embeddingsApiKey).toBeNull()
  })
})
