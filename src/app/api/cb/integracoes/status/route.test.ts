import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/integracoes/status — o ping da chave de um provedor testa o
// modelo do chat E o de cada agente de CONEXÃO ligado daquele provedor: a
// resposta automática legada chama o modelo da linha dela, e um modelo
// aposentado ali falharia com o cartão dizendo "funcionando" (Codex, #294).

const validateAiCredentials = vi.fn(async (cfg: { model: string; provider?: string }) => {
  if (modelosQueFalham.includes(cfg.model)) {
    const { AiError } = await import('@/lib/ai/types')
    throw new AiError('model not found', { code: 'model_not_found', status: 400 })
  }
})
let modelosQueFalham: string[] = []
let linhas: Record<string, unknown>[] = []
let semRespostaAutomatica: string[] = []

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'user-1',
    supabase: {
      from: (tabela: string) =>
        tabela === 'cb_channels'
          ? {
              // As conexões com a resposta automática DESLIGADA.
              select: () => ({
                eq: () => ({ eq: async () => ({ data: semRespostaAutomatica.map((id) => ({ id })), error: null }) }),
              }),
            }
          : { select: () => ({ eq: async () => ({ data: linhas, error: null }) }) },
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
  validateAiCredentials: (cfg: { model: string; provider?: string }) => validateAiCredentials(cfg),
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
import { lerChaveDeEmbeddings, lerEstado } from '@/lib/ia-chaves/repo'
import { listChannels } from '@/lib/cb-channels/repo'

beforeEach(() => {
  validateAiCredentials.mockClear()
  modelosQueFalham = []
  linhas = [
    { channel_id: null, provider: 'gemini', model: 'gemini-padrao', radar_model: null, is_active: true },
    { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-da-conexao', radar_model: null, is_active: true, auto_reply_enabled: true },
    { channel_id: 'canal-2', provider: 'gemini', model: 'gemini-desligado', radar_model: null, is_active: false, auto_reply_enabled: true },
  ]
  semRespostaAutomatica = []
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

describe('GET /api/cb/integracoes/status — chave da OpenAI recusada para a base (Codex, #294)', () => {
  it('o cartão da OpenAI fica ok e o uso da base diz que caiu na busca por palavras', async () => {
    vi.mocked(lerEstado).mockResolvedValueOnce([
      { provedor: 'gemini', existe: true },
      { provedor: 'openai', existe: true },
      { provedor: 'anthropic', existe: false },
    ] as never)
    vi.mocked(lerChaveDeEmbeddings).mockResolvedValueOnce({ chave: null, ilegivel: false, recusada: true } as never)
    const res = await GET(new Request('http://x/api/cb/integracoes/status'))
    const corpo = (await res.json()) as {
      cartoes: { id: string; estado: string; usos: { modulo: string; indisponivel?: string }[] }[]
    }
    const openai = corpo.cartoes.find((c) => c.id === 'openai')!
    expect(openai.usos.find((u) => u.modulo === 'rag')?.indisponivel).toBe('embeddings_recusados')
    expect(openai.estado).not.toBe('erro')
  })
})

describe('GET /api/cb/integracoes/status — a chave da OpenAI que é SÓ da base (Codex, #294)', () => {
  function estadoComOpenai(soDaBase: boolean) {
    vi.mocked(lerEstado).mockResolvedValueOnce([
      { provedor: 'gemini', existe: true },
      { provedor: 'openai', existe: true, soDaBase },
      { provedor: 'anthropic', existe: false },
    ] as never)
    vi.mocked(lerChaveDeEmbeddings).mockResolvedValueOnce({ chave: 'sk-emb', ilegivel: false, recusada: false } as never)
  }

  it('nada de chat usa a OpenAI: a chave só da base não é pingada no modelo de chat', async () => {
    estadoComOpenai(true)
    const res = await GET(new Request('http://x/api/cb/integracoes/status'))
    expect(res.status).toBe(200)
    expect(validateAiCredentials.mock.calls.some((c) => c[0].provider === 'openai')).toBe(false)
  })

  it('uma conexão usa a OpenAI no chat: aí o chat é pingado', async () => {
    linhas.push({ channel_id: 'canal-9', provider: 'openai', model: 'gpt-conexao', radar_model: null, is_active: true, auto_reply_enabled: true })
    estadoComOpenai(true)
    await GET(new Request('http://x/api/cb/integracoes/status'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toContain('gpt-conexao')
  })

  it('a OpenAI que nada de chat usa não é pingada no chat, mesmo com a chave vinda de uma conexão desligada', async () => {
    estadoComOpenai(false)
    await GET(new Request('http://x/api/cb/integracoes/status'))
    expect(validateAiCredentials.mock.calls.some((c) => c[0].provider === 'openai')).toBe(false)
  })

  it('a OpenAI usada no chat (linha padrão) é pingada', async () => {
    linhas = [{ channel_id: null, provider: 'openai', model: 'gpt-x', radar_model: null, is_active: true }]
    estadoComOpenai(false)
    await GET(new Request('http://x/api/cb/integracoes/status'))
    expect(validateAiCredentials.mock.calls.some((c) => c[0].provider === 'openai')).toBe(true)
  })
})

describe('GET /api/cb/integracoes/status — o modelo PRÓPRIO do Radar (Codex, #295)', () => {
  it('Radar ligado numa conexão e modelo próprio diferente do chat: é pingado', async () => {
    linhas[0] = { channel_id: null, provider: 'gemini', model: 'gemini-padrao', radar_model: 'gemini-radar', is_active: true }
    await cartaoGemini()
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toContain('gemini-radar')
  })

  it('Radar desligado em todas as conexões: o modelo dele não é pingado', async () => {
    linhas[0] = { channel_id: null, provider: 'gemini', model: 'gemini-padrao', radar_model: 'gemini-radar', is_active: true }
    vi.mocked(listChannels).mockResolvedValueOnce([{ id: 'canal-1', label: 'Comercial', radar_enabled: false }] as never)
    await cartaoGemini()
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).not.toContain('gemini-radar')
  })

  it('o modelo do Radar fora do ar deixa o cartão em erro', async () => {
    linhas[0] = { channel_id: null, provider: 'gemini', model: 'gemini-padrao', radar_model: 'gemini-radar', is_active: true }
    modelosQueFalham = ['gemini-radar']
    expect((await cartaoGemini()).estado).toBe('erro')
  })
})

describe('GET /api/cb/integracoes/status — a linha de conexão só conta com a resposta automática ligada (Codex, #294)', () => {
  it('resposta automática desligada na LINHA: o modelo dela não é pingado', async () => {
    linhas[1] = { ...linhas[1], auto_reply_enabled: false }
    await cartaoGemini()
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).not.toContain('gemini-da-conexao')
  })

  it('resposta automática desligada na CONEXÃO: o modelo dela não é pingado', async () => {
    semRespostaAutomatica = ['canal-1']
    await cartaoGemini()
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).not.toContain('gemini-da-conexao')
  })
})
