import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/integracoes/status — o ping da chave de um provedor testa o
// modelo do chat E o de cada agente de CONEXÃO ligado daquele provedor: a
// resposta automática legada chama o modelo da linha dela, e um modelo
// aposentado ali falharia com o cartão dizendo "funcionando" (Codex, #294).

const validateAiCredentials = vi.fn(async (cfg: { model: string }) => {
  if (modelosQueFalham.includes(cfg.model)) {
    const { AiError } = await import('@/lib/ai/types')
    throw new AiError('model not found', { code: 'model_not_found', status: 400 })
  }
})
let modelosQueFalham: string[] = []
let linhas: Record<string, unknown>[] = []

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'user-1',
    supabase: {
      from: () => ({
        select: () => ({ eq: async () => ({ data: linhas, error: null }) }),
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
vi.mock('@/lib/cb-channels/repo', () => ({
  listChannels: vi.fn(async () => [{ id: 'canal-1', label: 'Comercial', radar_enabled: true }]),
}))
vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: (cfg: { model: string }) => validateAiCredentials(cfg),
}))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: vi.fn(), EMBEDDING_MODEL: 'emb' }))
vi.mock('@/lib/transcricao/transcrever', () => ({ MODELO_TRANSCRICAO: 'trans' }))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerEstado: vi.fn(async () => [
    { provedor: 'gemini', existe: true },
    { provedor: 'openai', existe: false },
    { provedor: 'anthropic', existe: false },
  ]),
  lerChave: vi.fn(async () => ({ chave: 'g-chave', ilegivel: false })),
  lerChaveDeEmbeddings: vi.fn(),
}))

import { GET } from './route'

beforeEach(() => {
  validateAiCredentials.mockClear()
  modelosQueFalham = []
  linhas = [
    { channel_id: null, provider: 'gemini', model: 'gemini-padrao', radar_model: null, is_active: true },
    { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-da-conexao', radar_model: null, is_active: true },
    { channel_id: 'canal-2', provider: 'gemini', model: 'gemini-desligado', radar_model: null, is_active: false },
  ]
})

async function cartaoGemini() {
  const res = await GET(new Request('http://x/api/cb/integracoes/status'))
  const corpo = (await res.json()) as { cartoes: { id: string; estado: string }[] }
  return corpo.cartoes.find((c) => c.id === 'gemini')!
}

describe('GET /api/cb/integracoes/status — o ping cobre os agentes de conexão ligados', () => {
  it('pinga o modelo do chat e o da conexão LIGADA (a desligada não roda)', async () => {
    await cartaoGemini()
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model).sort()).toEqual([
      'gemini-da-conexao',
      'gemini-padrao',
    ])
  })

  it('o modelo da conexão falhando deixa o cartão em erro', async () => {
    modelosQueFalham = ['gemini-da-conexao']
    expect((await cartaoGemini()).estado).toBe('erro')
  })

  it('tudo respondendo = ok', async () => {
    expect((await cartaoGemini()).estado).toBe('ok')
  })
})
