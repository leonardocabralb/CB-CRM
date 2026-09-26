import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// /api/cb/ia/agentes/[id]/playground — o Playground testa o que a produção
// manda: a triagem recebe o MESMO bloco de passagem (D25) que o turno monta,
// e a resposta segue a régua do turno (a transferência vence a passagem, o
// marcador nunca aparece como resposta, número que não existe transfere).
// F3: o contato escolhido é conferido NA CONTA, os blocos de acesso e a base
// do agente entram no pedido pela MESMA leitura do turno, e a resposta diz o
// que o agente viu (`vistos`).
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'
const CONTATO = '33333333-3333-4333-8333-333333333333'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { aiDraft: {}, aiDraftAccount: {} },
}))
// Os contatos da conta (a conferência do `contactId`), com a consulta anotada.
const contatosDaConta = new Set<string>()
let erroDoContato: { message: string } | null = null
const filtrosDoContato: Array<[string, unknown]> = []
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          filtrosDoContato.push([c, v])
          return q
        },
        maybeSingle: async () => {
          const id = filtrosDoContato.find(([c]) => c === 'id')?.[1] as string
          const conta = filtrosDoContato.find(([c]) => c === 'account_id')?.[1]
          if (erroDoContato) return { data: null, error: erroDoContato }
          return { data: conta === 'conta-1' && contatosDaConta.has(id) ? { id } : null, error: null }
        },
      }
      return q
    },
  }),
}))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(async () => ({ chave: 'sk-x', ilegivel: false })),
  lerEstado: vi.fn(async () => []),
}))

const agentes: Record<string, unknown> = {}
vi.mock('@/lib/ia-agentes/repo', () => ({
  obterAgente: vi.fn(async (_conta: string, id: string) => agentes[id] ?? null),
}))

// O que o agente vê (F3): a leitura é a do turno, aqui um dublê.
let visto = {
  blocos: [] as Array<{ bloco: string; texto: string }>,
  trechos: [] as Array<{ id: string; documentoId: string; content: string }>,
  retrato: { blocos: [] as Array<{ bloco: string; texto: string }>, documentos: [] as string[] },
}
vi.mock('@/lib/ia-agentes/acesso', () => ({ lerOQueOAgenteVe: vi.fn(async () => visto) }))

let resposta = { text: 'Olá!', handoff: false }
vi.mock('@/lib/ai/generate', () => ({
  generateReply: vi.fn(async () => ({ ...resposta, usage: null })),
}))

import { generateReply } from '@/lib/ai/generate'
import { lerOQueOAgenteVe } from '@/lib/ia-agentes/acesso'
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
    acesso: { ficha: false, campos: [], negocio: false, etiquetas: false, cobrancas: true, reuniao: false },
    ...extra,
  }
}

function enviar(extra: Record<string, unknown> = {}) {
  return POST(
    new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, {
      method: 'POST',
      body: JSON.stringify({ messages: [{ role: 'user', content: '[image] quero pagar o boleto' }], ...extra }),
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
  vi.mocked(lerOQueOAgenteVe).mockClear()
  contatosDaConta.clear()
  contatosDaConta.add(CONTATO)
  erroDoContato = null
  filtrosDoContato.length = 0
  visto = { blocos: [], trechos: [], retrato: { blocos: [], documentos: [] } }
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

describe('POST /api/cb/ia/agentes/[id]/playground — o que o agente vê (F3)', () => {
  it('sem contato: a base do agente entra, os blocos não (a leitura recebe contato nulo)', async () => {
    visto = {
      blocos: [],
      trechos: [{ id: 't1', documentoId: 'doc-1', content: 'Horário: 9h às 18h.' }],
      retrato: { blocos: [], documentos: ['doc-1'] },
    }
    const corpo = await (await enviar()).json()
    const args = vi.mocked(lerOQueOAgenteVe).mock.calls[0][1]
    expect(args).toMatchObject({ accountId: 'conta-1', contactId: null, dealId: null })
    // A consulta à base é a última mensagem do cliente SEM o rótulo da mídia.
    expect(args.consulta).toBe('quero pagar o boleto')
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toContain('[1] Horário: 9h às 18h.')
    expect(corpo.vistos).toEqual({ blocos: [], documentos: 1 })
  })

  it('com contato da conta: os blocos dele vão ao modelo e voltam em `vistos`', async () => {
    visto = {
      blocos: [{ bloco: 'cobrancas', texto: 'Billing (Asaas) — overdue installments:\n- installment 3/12' }],
      trechos: [],
      retrato: { blocos: [], documentos: [] },
    }
    const corpo = await (await enviar({ contactId: CONTATO })).json()
    expect(vi.mocked(lerOQueOAgenteVe).mock.calls[0][1]).toMatchObject({ contactId: CONTATO })
    expect(filtrosDoContato).toContainEqual(['account_id', 'conta-1'])
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('What you know about this customer')
    expect(pedido).toContain('installment 3/12')
    expect(corpo.vistos).toEqual({ blocos: ['cobrancas'], documentos: 0 })
  })

  it('contato de OUTRA conta (ou que não existe): 404 contato_nao_encontrado, sem gerar', async () => {
    contatosDaConta.clear()
    const res = await enviar({ contactId: CONTATO })
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('contato_nao_encontrado')
    expect(generateReply).not.toHaveBeenCalled()
    expect(lerOQueOAgenteVe).not.toHaveBeenCalled()
  })

  it('contactId que não é uuid: 404, sem consultar nada', async () => {
    const res = await enviar({ contactId: 'maria' })
    expect(res.status).toBe(404)
    expect(filtrosDoContato).toHaveLength(0)
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('erro de banco ao conferir o contato é 500, nunca "não encontrado"', async () => {
    erroDoContato = { message: 'timeout' }
    const res = await enviar({ contactId: CONTATO })
    expect(res.status).toBe(500)
    expect(generateReply).not.toHaveBeenCalled()
  })
})
