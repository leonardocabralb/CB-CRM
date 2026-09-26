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
// A linha padrão de `ai_configs` (os modelos EM USO) e as chaves que "alcançam"
// cada modelo no dublê do provedor.
let linhaPadrao: Record<string, unknown> | null = null
let alcanca: (chave: string, modelo: string) => boolean = () => true
let chaveAtual: string | null = null
const validateAiCredentials = vi.fn(async (cfg: { apiKey: string; model: string }) => {
  if (!alcanca(cfg.apiKey, cfg.model)) {
    const { AiError } = await import('@/lib/ai/types')
    throw new AiError(`model ${cfg.model} not found`, { code: 'provider_error', status: 404 })
  }
})

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
vi.mock('@/lib/ai/validate', () => ({
  validateAiCredentials: (cfg: { apiKey: string; model: string }) => validateAiCredentials(cfg),
}))
vi.mock('@/lib/ai/embeddings', () => ({ embedTexts: (...a: unknown[]) => embedTexts(...a) }))
let linhasPorConexao: Record<string, unknown>[] = []
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: [...(linhaPadrao ? [{ channel_id: null, ...linhaPadrao }] : []), ...linhasPorConexao],
          error: null,
        }),
      }),
    }),
  }),
}))
let agentesDaConta: { provedor: string; modelo: string }[] = []
vi.mock('@/lib/ia-agentes/repo', () => ({
  listarAgentes: vi.fn(async () => agentesDaConta),
}))
vi.mock('@/lib/ia-chaves/repo', () => ({
  apagarChave: vi.fn(),
  ehProvedor: (v: unknown) => v === 'openai' || v === 'gemini' || v === 'anthropic',
  gravarChave: (...a: unknown[]) => gravarChave(...(a as [])),
  lerChave: vi.fn(async () => ({ chave: chaveAtual, ilegivel: false })),
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
  validateAiCredentials.mockClear()
  linhaPadrao = null
  linhasPorConexao = []
  alcanca = () => true
  chaveAtual = null
  agentesDaConta = []
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

describe('PUT /api/cb/ia/chaves — a chave nova é conferida nos modelos EM USO (Codex, #294)', () => {
  it('confere o modelo do assistente E o do Radar, não só o padrão do provedor', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-b' }
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(200)
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-a', 'gemini-b'])
  })

  it('a nova não alcança o modelo em uso e a ATUAL alcança: recusa, e nada é gravado', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-restrito' }
    chaveAtual = 'sk-atual'
    alcanca = (chave, modelo) => !(chave === 'sk-teste' && modelo === 'gemini-restrito')
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'modelo_em_uso_recusado', modelo: 'gemini-restrito' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('nem a atual alcança o modelo (aposentado): aceita e avisa qual trocar', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-velho' }
    chaveAtual = 'sk-atual'
    alcanca = (_chave, modelo) => modelo !== 'gemini-velho'
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      ok: true,
      avisos: ['modelo_em_uso_indisponivel'],
      modelos: ['gemini-velho'],
    })
    expect(gravarChave).toHaveBeenCalled()
  })

  it('nenhum modelo em uso responde e nem o padrão: é a chave — recusa', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    alcanca = (chave) => chave !== 'sk-teste'
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('outro provedor na linha padrão: confere só o modelo padrão deste', async () => {
    linhaPadrao = { provider: 'openai', model: 'gpt-x', radar_model: 'gpt-y' }
    embedTexts.mockResolvedValue([[0.1]])
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash'])
  })
})

describe('PUT /api/cb/ia/chaves — os modelos dos AGENTES também contam (F1b)', () => {
  it('confere o modelo de cada agente deste provedor, sem repetir', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-a' }
    agentesDaConta = [
      { provedor: 'gemini', modelo: 'gemini-b', ativo: true },
      { provedor: 'gemini', modelo: 'gemini-a', ativo: true },
      { provedor: 'openai', modelo: 'gpt-x', ativo: true },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-a', 'gemini-b'])
  })

  it('a nova não alcança o modelo de um agente que a atual alcança: recusa', async () => {
    agentesDaConta = [{ provedor: 'gemini', modelo: 'gemini-do-agente', ativo: true }]
    chaveAtual = 'sk-atual'
    alcanca = (chave, modelo) => !(chave === 'sk-teste' && modelo === 'gemini-do-agente')
    const res = await PUT(pedido('gemini'))
    expect(await res.json()).toMatchObject({ code: 'modelo_em_uso_recusado', modelo: 'gemini-do-agente' })
  })
})

describe('PUT /api/cb/ia/chaves — as linhas POR CONEXÃO também contam (Codex, #294)', () => {
  it('confere o modelo do agente de uma conexão do mesmo provedor (e só o model dele)', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    linhasPorConexao = [
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-da-conexao', radar_model: 'nao-conta' },
      { channel_id: 'canal-2', provider: 'openai', model: 'gpt-x', radar_model: null },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-a', 'gemini-da-conexao'])
  })

  it('a conexão DESLIGADA não conta (não roda); a padrão desligada conta (o Radar a lê)', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: false }
    linhasPorConexao = [
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-desligado', radar_model: null, is_active: false },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-a'])
  })
})
