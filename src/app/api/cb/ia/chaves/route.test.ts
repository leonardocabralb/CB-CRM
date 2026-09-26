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
// Falha PASSAGEIRA (tempo esgotado, rede, limite) no dublê: o código, ou nulo.
let passageira: (chave: string, modelo: string) => string | null = () => null
const validateAiCredentials = vi.fn(async (cfg: { apiKey: string; model: string }) => {
  const codigo = passageira(cfg.apiKey, cfg.model)
  if (codigo) {
    const { AiError } = await import('@/lib/ai/types')
    // `5xx` imita o provedor fora do ar: `provider_error` com o status dele.
    if (codigo === '5xx') throw new AiError('503', { code: 'provider_error', upstreamStatus: 503 })
    throw new AiError(codigo, { code: codigo })
  }
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
// Há conexão com o Radar ligado? (os modelos do Radar só contam com ele.)
let radarLigado = true
let erroNoLegado: { message: string } | null = null
let semRespostaAutomatica: string[] = []
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) =>
      tabela === 'cb_channels'
        ? {
            select: () => ({
              eq: () => ({
                eq: (coluna: string) => {
                  // `radar_enabled = true` (com limit) ou `ai_autoreply_enabled = false`.
                  if (coluna === 'radar_enabled') {
                    return { limit: async () => ({ data: radarLigado ? [{ id: 'canal-r' }] : [], error: null }) }
                  }
                  const fim = { data: semRespostaAutomatica.map((id) => ({ id })), error: null }
                  return { then: (r: (v: unknown) => unknown) => r(fim) }
                },
              }),
            }),
          }
        : ({
      // O espelho legado de `ai_configs` (o DELETE limpa a cópia).
      update: () => {
        const fim = { error: erroNoLegado }
        const eq: Record<string, unknown> = {}
        eq.eq = () => eq
        eq.then = (r: (v: unknown) => unknown) => r(fim)
        return eq
      },
      select: () => ({
        eq: async () => ({
          data: [...(linhaPadrao ? [{ channel_id: null, ...linhaPadrao }] : []), ...linhasPorConexao],
          error: null,
        }),
      }),
    }),
  }),
}))
let agentesDaConta: { provedor: string; modelo: string; ativo: boolean }[] = []
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
import { DELETE, PUT } from './route'
import { apagarChave } from '@/lib/ia-chaves/repo'

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
  passageira = () => null
  chaveAtual = null
  agentesDaConta = []
  radarLigado = true
  erroNoLegado = null
  semRespostaAutomatica = []
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
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a', 'gemini-b'])
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
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a', 'gemini-b'])
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
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-da-conexao', radar_model: 'nao-conta', auto_reply_enabled: true },
      { channel_id: 'canal-2', provider: 'openai', model: 'gpt-x', radar_model: null, auto_reply_enabled: true },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a', 'gemini-da-conexao'])
  })

  it('a linha PADRÃO vem antes das de conexão, qualquer que seja a ordem do banco (Codex, #295)', async () => {
    linhaPadrao = null
    linhasPorConexao = [
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-da-conexao', radar_model: null, auto_reply_enabled: true },
      { channel_id: null, provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-radar' },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual([
      'gemini-3.7-flash',
      'gemini-a',
      'gemini-radar',
      'gemini-da-conexao',
    ])
  })

  it('a conexão DESLIGADA não conta (não roda); a padrão desligada conta (o Radar a lê)', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: false }
    linhasPorConexao = [
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-desligado', radar_model: null, is_active: false, auto_reply_enabled: true },
    ]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a'])
  })
})

describe('PUT /api/cb/ia/chaves — a transcrição usa o modelo FIXO com a chave do Gemini (Codex, #294)', () => {
  it('o modelo da transcrição é conferido mesmo quando o assistente usa outro modelo do Gemini', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-customizado', radar_model: null }
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toContain('gemini-3.7-flash')
  })

  it('sem chave atual e a nova não alcança a transcrição: recusa (não há modelo a trocar), nada gravado', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    chaveAtual = null
    alcanca = (_chave, modelo) => modelo !== 'gemini-3.7-flash'
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'transcricao_recusada', modelo: 'gemini-3.7-flash' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('sem chave atual e a transcrição só deu tempo esgotado: devolve o erro passageiro, não "recusada"', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    passageira = (_chave, modelo) => (modelo === 'gemini-3.7-flash' ? 'timeout' : null)
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'timeout' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('a atual alcança a transcrição e a nova não: recusa pela regra geral', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    chaveAtual = 'sk-atual'
    alcanca = (chave, modelo) => !(chave === 'sk-teste' && modelo === 'gemini-3.7-flash')
    const res = await PUT(pedido('gemini'))
    expect(await res.json()).toMatchObject({ code: 'modelo_em_uso_recusado', modelo: 'gemini-3.7-flash' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('nem a atual alcança a transcrição: aceita com aviso PRÓPRIO, sem mandar trocar modelo', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    chaveAtual = 'sk-atual'
    alcanca = (_chave, modelo) => modelo !== 'gemini-3.7-flash'
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, avisos: ['transcricao_indisponivel'], modelos: [] })
    expect(gravarChave).toHaveBeenCalled()
  })
})

describe('PUT /api/cb/ia/chaves — agente desligado e o teto de modelos (Codex, #295)', () => {
  it('agente DESLIGADO não conta', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null }
    agentesDaConta = [{ provedor: 'gemini', modelo: 'gemini-desligado', ativo: false }]
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a'])
  })

  it('confere no máximo 5 modelos; os demais voltam no aviso', async () => {
    linhaPadrao = { provider: 'gemini', model: 'm1', radar_model: null }
    agentesDaConta = ['m2', 'm3', 'm4', 'm5', 'm6', 'm7'].map((modelo) => ({ provedor: 'gemini', modelo, ativo: true }))
    const res = await PUT(pedido('gemini'))
    const corpo = (await res.json()) as { avisos: string[]; naoConferidos: string[] }
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'm1', 'm2', 'm3', 'm4'])
    expect(corpo.avisos).toContain('modelos_nao_conferidos')
    expect(corpo.naoConferidos).toEqual(['m5', 'm6', 'm7'])
  })
})

describe('PUT /api/cb/ia/chaves — falha PASSAGEIRA não vira "não alcança o modelo" (Codex, #294)', () => {
  it('um modelo em uso dá tempo esgotado com a nova: nada é gravado, volta o erro passageiro', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-b' }
    chaveAtual = 'sk-atual'
    passageira = (chave, modelo) => (chave === 'sk-teste' && modelo === 'gemini-b' ? 'timeout' : null)
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'timeout' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('a conferência com a ATUAL é passageira: não decide, nada é gravado', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-b' }
    chaveAtual = 'sk-atual'
    alcanca = (chave, modelo) => !(chave === 'sk-teste' && modelo === 'gemini-b')
    passageira = (chave, modelo) => (chave === 'sk-atual' && modelo === 'gemini-b' ? 'network_error' : null)
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'network' })
    expect(gravarChave).not.toHaveBeenCalled()
  })
})

describe('PUT /api/cb/ia/chaves — o 5xx do provedor também é passageiro (Codex, #294)', () => {
  it('um modelo em uso devolve 503 com a nova: nada é gravado', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-b' }
    chaveAtual = 'sk-atual'
    passageira = (chave, modelo) => (chave === 'sk-teste' && modelo === 'gemini-b' ? '5xx' : null)
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'provider_error' })
    expect(gravarChave).not.toHaveBeenCalled()
  })

  it('o 404 do modelo continua sendo "não alcança" (a regra geral decide)', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-velho' }
    chaveAtual = 'sk-atual'
    alcanca = (_chave, modelo) => modelo !== 'gemini-velho'
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ avisos: ['modelo_em_uso_indisponivel'] })
  })
})

describe('PUT /api/cb/ia/chaves — só os modelos que RODAM são conferidos (Codex, #294)', () => {
  it('assistente desligado e o Radar com modelo próprio: o modelo do assistente não conta', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-sem-uso', radar_model: 'gemini-radar', is_active: false }
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-radar'])
  })

  it('assistente desligado e o Radar HERDANDO: o modelo do assistente conta', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-herdado', radar_model: null, is_active: false }
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-herdado'])
  })

  it('nenhuma conexão com o Radar: o modelo do Radar não conta', async () => {
    radarLigado = false
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: 'gemini-radar', is_active: true }
    await PUT(pedido('gemini'))
    expect(validateAiCredentials.mock.calls.map((c) => c[0].model)).toEqual(['gemini-3.7-flash', 'gemini-a'])
  })

  it('a nova não alcança um modelo que nada usa: não recusa', async () => {
    radarLigado = false
    linhaPadrao = { provider: 'gemini', model: 'gemini-sem-uso', radar_model: null, is_active: false }
    chaveAtual = 'sk-atual'
    alcanca = (chave, modelo) => !(chave === 'sk-teste' && modelo === 'gemini-sem-uso')
    const res = await PUT(pedido('gemini'))
    expect(res.status).toBe(200)
    expect(gravarChave).toHaveBeenCalled()
  })
})

describe('DELETE /api/cb/ia/chaves — a cópia legada sai ANTES da chave (Codex, #294)', () => {
  const apagar = (provedor: string) =>
    DELETE(new Request(`http://x/api/cb/ia/chaves?provedor=${provedor}`, { method: 'DELETE' }))

  it('limpeza da cópia falhou: 500 e a chave de verdade NÃO sai (a tela diz a verdade)', async () => {
    vi.mocked(apagarChave).mockClear()
    erroNoLegado = { message: 'timeout' }
    const res = await apagar('gemini')
    expect(res.status).toBe(500)
    expect(apagarChave).not.toHaveBeenCalled()
  })

  it('limpeza ok: a chave sai e a resposta diz ok', async () => {
    vi.mocked(apagarChave).mockClear().mockResolvedValue(true)
    const res = await apagar('gemini')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, apagada: true })
    expect(apagarChave).toHaveBeenCalledWith('conta-1', 'gemini')
  })
})

describe('PUT /api/cb/ia/chaves — a conexão só conta com a resposta automática ligada (Codex, #294)', () => {
  it('desligada na linha ou na conexão: o modelo dela não é conferido', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: true }
    linhasPorConexao = [
      { channel_id: 'canal-1', provider: 'gemini', model: 'gemini-linha-sem-auto', radar_model: null, is_active: true, auto_reply_enabled: false },
      { channel_id: 'canal-2', provider: 'gemini', model: 'gemini-conexao-sem-auto', radar_model: null, is_active: true, auto_reply_enabled: true },
    ]
    semRespostaAutomatica = ['canal-2']
    await PUT(pedido('gemini'))
    const modelos = validateAiCredentials.mock.calls.map((c) => c[0].model)
    expect(modelos).not.toContain('gemini-linha-sem-auto')
    expect(modelos).not.toContain('gemini-conexao-sem-auto')
  })
})

describe('PUT /api/cb/ia/chaves — a OpenAI que nenhum chat usa é conferida pelos embeddings (Codex, #294)', () => {
  it('chave só de embeddings: aceita sem pedir o modelo de chat', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: true }
    embedTexts.mockResolvedValue([[0.1]])
    alcanca = () => false // o chat recusaria
    const res = await PUT(pedido('openai'))
    expect(res.status).toBe(200)
    expect(validateAiCredentials).not.toHaveBeenCalled()
    expect(gravarChave).toHaveBeenCalled()
  })

  it('embeddings recusados: segue pelo chat — a chave de chat é aceita (pode ser para passar o assistente à OpenAI)', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: true }
    embedTexts.mockRejectedValue(new AiError('no', { code: 'invalid_key' }))
    const res = await PUT(pedido('openai'))
    expect(res.status).toBe(200)
    expect(validateAiCredentials).toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ avisos: ['embeddings_recusado'] })
  })

  it('nem embedding nem chat: a chave é recusada', async () => {
    linhaPadrao = { provider: 'gemini', model: 'gemini-a', radar_model: null, is_active: true }
    embedTexts.mockRejectedValue(new AiError('no', { code: 'invalid_key' }))
    alcanca = () => false
    const res = await PUT(pedido('openai'))
    expect(res.status).toBe(400)
    expect(gravarChave).not.toHaveBeenCalled()
  })
})
