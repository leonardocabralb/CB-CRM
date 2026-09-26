import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/ai/config — qualquer membro lê (a caixa de entrada precisa saber se
// a IA está configurada), mas o PROMPT só sai para administrador (D14 do
// docs/PLANO-agentes-de-ia.md; Codex, #295): a tela esconde, e a rota tem de
// esconder junto — senão um atendente o lia chamando a rota direto.

let papel: 'owner' | 'admin' | 'agent' | 'viewer' = 'agent'

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({
    accountId: 'conta-1',
    userId: 'user-1',
    role: papel,
    // O cliente da SESSÃO não lê `ai_configs` (1048: só admin lê direto); a
    // rota lê pelo serviço. Se voltar a ler por aqui, o teste estoura.
    supabase: {
      from: () => {
        throw new Error('ai_configs lida pelo cliente da sessão')
      },
    },
  })),
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1', supabase: {} })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                provider: 'gemini',
                model: 'gemini-3.7-flash',
                radar_model: null,
                system_prompt: 'segredo do escritório',
                is_active: true,
                auto_reply_enabled: false,
                auto_reply_max_per_conversation: 3,
                handoff_agent_id: null,
              },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(),
  lerEstado: vi.fn(async () => [
    { provedor: 'gemini', existe: true, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
    { provedor: 'openai', existe: false, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
    { provedor: 'anthropic', existe: false, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
  ]),
}))

import { GET, POST } from './route'

beforeEach(() => {
  papel = 'agent'
})

describe('GET /api/ai/config — o prompt só para administrador', () => {
  it('atendente e visualizador recebem a configuração SEM o prompt', async () => {
    for (const p of ['agent', 'viewer'] as const) {
      papel = p
      const corpo = (await (await GET()).json()) as Record<string, unknown>
      expect(corpo.configured, p).toBe(true)
      expect(corpo.is_active, p).toBe(true)
      expect('system_prompt' in corpo, p).toBe(false)
    }
  })

  it('administrador e dono recebem o prompt', async () => {
    for (const p of ['admin', 'owner'] as const) {
      papel = p
      const corpo = (await (await GET()).json()) as Record<string, unknown>
      expect(corpo.system_prompt, p).toBe('segredo do escritório')
    }
  })
})

describe('POST /api/ai/config — aba aberta do app anterior (Codex, #294)', () => {
  function pedido(corpo: Record<string, unknown>) {
    return new Request('http://x/api/ai/config', { method: 'POST', body: JSON.stringify(corpo) })
  }

  it('chave no corpo = 409 pedindo para recarregar, nunca "salvo"', async () => {
    for (const corpo of [
      { provider: 'gemini', model: 'm', api_key: 'sk-nova' },
      { provider: 'gemini', model: 'm', embeddings_api_key: 'sk-emb' },
      { provider: 'gemini', model: 'm', embeddings_api_key: null },
    ]) {
      const res = await POST(pedido(corpo))
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ code: 'tela_desatualizada' })
    }
  })
})

describe('POST /api/ai/config — a gravação da linha vai pelo serviço (Codex, #294)', () => {
  it('nenhuma escrita em ai_configs pelo cliente da sessão', () => {
    const fonte = readFileSync(join(__dirname, 'route.ts'), 'utf8').replace(/\/\/.*$/gm, '')
    const post = fonte.slice(fonte.indexOf('export async function POST'))
    // O gatilho da janela (1047) copia a escrita do NAVEGADOR para
    // cb_ia_chaves; o espelho do app novo não pode passar por ali.
    expect(post).not.toMatch(/supabase\s*\.from\(\s*'ai_configs'\s*\)\s*\.(update|insert|upsert|delete)\(/)
    expect(post).not.toMatch(/await\s+supabase\s*\n?\s*\.from\(\s*'ai_configs'\s*\)\s*\n?\s*\.(update|insert|upsert|delete)\(/)
    expect(post).toMatch(/const\s+db\s*=\s*supabaseAdmin\(\)/)
    expect(post).toMatch(/db\s*\.from\(\s*'ai_configs'\s*\)\s*\.update\(/)
    expect(post).toMatch(/db\.from\(\s*'ai_configs'\s*\)\.insert\(/)
  })
})

describe('POST /api/ai/config — a chave só da base não liga o assistente (Codex, #295)', () => {
  it('confere a marca ANTES de decidir se valida (ligar só muda o interruptor e pula a validação)', () => {
    const fonte = readFileSync(join(__dirname, 'route.ts'), 'utf8').replace(/\/\/.*$/gm, '')
    const post = fonte.slice(fonte.indexOf('export async function POST'))
    const marca = post.search(/provider\s*===\s*'openai'\s*&&\s*\(isActive\s*\|\|\s*autoReplyEnabled\)[\s\S]{0,200}soDaBase/)
    expect(marca).toBeGreaterThan(-1)
    expect(post.slice(marca, marca + 400)).toContain("code: 'provedor_so_da_base'")
    expect(marca).toBeLessThan(post.indexOf('const credentialsChanged'))
  })
})
