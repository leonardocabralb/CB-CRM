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
    // O cliente da SESSÃO não lê `ai_configs` (1043: só admin lê direto); a
    // rota lê pelo serviço. Se voltar a ler por aqui, o teste estoura.
    supabase: {
      from: () => {
        throw new Error('ai_configs lida pelo cliente da sessão')
      },
    },
  })),
  requireRole: vi.fn(),
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
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(),
  lerEstado: vi.fn(async () => [
    { provedor: 'gemini', existe: true, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
    { provedor: 'openai', existe: false, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
    { provedor: 'anthropic', existe: false, atualizadaEm: null, serveEmbeddings: null, temChaveDeEmbeddings: false },
  ]),
}))

import { GET } from './route'

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
