import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// PUT /api/cb/ia/chaves — a conferência dos EMBEDDINGS da chave da OpenAI
// (Codex, PR #294). Uma chave de projeto restrita gera texto e não gera
// embedding: gravada como "serve", toda resposta e toda indexação tentariam
// (e falhariam) a busca por sentido antes de cair na por palavras. A rota
// grava o VEREDITO da conferência junto com a chave:
//   - a OpenAI aceitou → `true`;
//   - a OpenAI RECUSOU (401/403, `invalid_key`) → `false` + aviso;
//   - não houve resposta (rede, limite, 5xx) → `null` (nada afirmado) + aviso.
// ============================================================

const gravarChave = vi.fn(async () => {})
const embedTexts = vi.fn()

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { id: 'cfg' }, error: null }) }) }),
        }),
      }),
    },
  })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { integracoesPing: {}, adminAction: {} },
}))
vi.mock('@/lib/ai/validate', () => ({ validateAiCredentials: vi.fn(async () => {}) }))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: (...a: unknown[]) => embedTexts(...a) }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/ia-chaves/repo', () => ({
  apagarChave: vi.fn(),
  ehProvedor: (v: unknown) => v === 'openai' || v === 'gemini' || v === 'anthropic',
  gravarChave: (...a: unknown[]) => gravarChave(...(a as [])),
  lerEstado: vi.fn(),
}))

import { AiError } from '@/lib/ai/types'
import { PUT } from './route'

function pedido(provedor: string) {
  return new Request('http://x/api/cb/ia/chaves', {
    method: 'PUT',
    body: JSON.stringify({ provedor, chave: 'sk-teste' }),
  })
}

beforeEach(() => {
  gravarChave.mockClear()
  embedTexts.mockReset()
})

describe('PUT /api/cb/ia/chaves — a chave da OpenAI guarda se serve aos embeddings', () => {
  it('a OpenAI aceitou o embedding: grava `true`, sem aviso', async () => {
    embedTexts.mockResolvedValue([[0.1]])
    const res = await PUT(pedido('openai'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, avisos: [] })
    expect(gravarChave).toHaveBeenCalledWith('conta-1', 'openai', 'sk-teste', 'user-1', true)
  })

  it('a OpenAI RECUSOU (invalid_key): grava `false` e avisa `embeddings_recusado`', async () => {
    embedTexts.mockRejectedValue(new AiError('OpenAI embeddings rejected the API key', { code: 'invalid_key', status: 401 }))
    const res = await PUT(pedido('openai'))
    expect(await res.json()).toMatchObject({ ok: true, avisos: ['embeddings_recusado'] })
    expect(gravarChave).toHaveBeenCalledWith('conta-1', 'openai', 'sk-teste', 'user-1', false)
  })

  it('sem resposta (rede, limite): não afirma nada (`null`) e avisa `embeddings_nao_conferido`', async () => {
    embedTexts.mockRejectedValue(new AiError('rate limit', { code: 'rate_limited', status: 429 }))
    const res = await PUT(pedido('openai'))
    expect(await res.json()).toMatchObject({ ok: true, avisos: ['embeddings_nao_conferido'] })
    expect(gravarChave).toHaveBeenCalledWith('conta-1', 'openai', 'sk-teste', 'user-1', null)
  })

  it('outro provedor não confere embedding nenhum', async () => {
    const res = await PUT(pedido('gemini'))
    expect(await res.json()).toMatchObject({ ok: true, avisos: [] })
    expect(embedTexts).not.toHaveBeenCalled()
    expect(gravarChave).toHaveBeenCalledWith('conta-1', 'gemini', 'sk-teste', 'user-1', null)
  })
})
