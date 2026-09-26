import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// /api/cb/ia/agentes/[id]/playground — o Playground testa o que a produção
// manda: a triagem recebe o MESMO bloco de passagem (D25) que o turno monta,
// e a resposta segue a régua do turno (a transferência vence a passagem, o
// marcador nunca aparece como resposta, número que não existe transfere).
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { aiDraft: {}, aiDraftAccount: {} },
}))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(async () => ({ chave: 'sk-x', ilegivel: false })),
  lerEstado: vi.fn(async () => []),
}))

const agentes: Record<string, unknown> = {}
vi.mock('@/lib/ia-agentes/repo', () => ({
  obterAgente: vi.fn(async (_conta: string, id: string) => agentes[id] ?? null),
}))

let resposta = { text: 'Olá!', handoff: false }
vi.mock('@/lib/ai/generate', () => ({
  generateReply: vi.fn(async () => ({ ...resposta, usage: null })),
}))

import { generateReply } from '@/lib/ai/generate'
import { POST } from './route'

function agente(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    nome: id,
    descricao: `faz ${id}`,
    ativo: true,
    arquivadoEm: null,
    provedor: 'anthropic',
    modelo: 'm',
    instrucoes: 'x',
    regras: [],
    tetoRespostas: 5,
    podePassarPara: [],
    ...extra,
  }
}

function enviar() {
  return POST(
    new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: 'quero pagar o boleto' }] }),
    }),
    { params: Promise.resolve({ id: ID }) },
  )
}

beforeEach(() => {
  for (const k of Object.keys(agentes)) delete agentes[k]
  agentes[ID] = agente(ID, { nome: 'Triagem', podePassarPara: ['cobranca', 'desligado', 'arquivado', 'sumido'] })
  agentes.cobranca = agente('cobranca', { nome: 'Cobrança' })
  agentes.desligado = agente('desligado', { ativo: false })
  agentes.arquivado = agente('arquivado', { arquivadoEm: '2026-09-01T00:00:00Z' })
  resposta = { text: 'Olá!', handoff: false }
  vi.mocked(generateReply).mockClear()
})

describe('POST /api/cb/ia/agentes/[id]/playground — passagem (D25)', () => {
  it('manda ao modelo o bloco de passagem só com os agentes que podem receber', async () => {
    await enviar()
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('[[PASSAR:n]]')
    expect(pedido).toContain('1. Cobrança — faz cobranca')
    expect(pedido).not.toMatch(/desligado|arquivado|sumido/)
  })

  it('agente sem pode_passar_para: nenhum bloco de passagem', async () => {
    agentes[ID] = agente(ID)
    await enviar()
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).not.toContain('PASSAR')
  })

  it('a passagem mostra o destino e nunca o marcador', async () => {
    resposta = { text: '[[PASSAR:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: '', handoff: false, passaPara: 'Cobrança' })
  })

  it('número que não existe transfere para gente, como no turno', async () => {
    resposta = { text: '[[PASSAR:7]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: '', handoff: true, passaPara: null })
  })

  it('a transferência vence a passagem', async () => {
    resposta = { text: '[[PASSAR:1]]', handoff: true }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ handoff: true, passaPara: null })
  })

  it('resposta comum passa intacta', async () => {
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: 'Olá!', handoff: false, passaPara: null })
  })
})
