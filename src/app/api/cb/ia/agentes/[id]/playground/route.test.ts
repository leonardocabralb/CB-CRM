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
vi.mock('@/lib/ia-agentes/acesso', async (original) => ({
  ...(await original<typeof import('@/lib/ia-agentes/acesso')>()),
  lerOQueOAgenteVe: vi.fn(async () => visto),
}))

// As AÇÕES (F4): as opções do pedido, um dublê; a execução NUNCA pode ser
// chamada no Playground.
let opcoesDeAcao: Record<string, Array<{ id: string; nome: string }>> = {}
vi.mock('@/lib/ia-agentes/ferramentas', () => ({ opcoesDoAgente: vi.fn(async () => opcoesDeAcao) }))
vi.mock('@/lib/ia-agentes/executar-acoes', () => ({ executarAcoes: vi.fn(), anotarNaConversa: vi.fn() }))
// A agenda (F5): os horários AO VIVO são um dublê; marcar NUNCA pode ser chamado no Playground.
type Agenda = {
  tipoDeEvento: string
  lida: boolean
  horarios: Array<{ id: string; nome: string; textoNoPedido?: string }>
  temEmail: boolean
  reuniaoMarcada?: { inicio: string; remarcar: string | null } | null
}
let agenda: Agenda | null = null
vi.mock('@/lib/ia-agentes/agenda', () => ({
  lerAgendaDoAgente: vi.fn(async () => agenda),
  marcarNoCalendly: vi.fn(),
}))

let resposta = { text: 'Olá!', handoff: false }
vi.mock('@/lib/ai/generate', () => ({
  generateReply: vi.fn(async () => ({ ...resposta, usage: null })),
}))

import { generateReply } from '@/lib/ai/generate'
import { lerOQueOAgenteVe } from '@/lib/ia-agentes/acesso'
import { lerAgendaDoAgente, marcarNoCalendly } from '@/lib/ia-agentes/agenda'
import { executarAcoes } from '@/lib/ia-agentes/executar-acoes'
import { opcoesDoAgente } from '@/lib/ia-agentes/ferramentas'
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
    ferramentas: {},
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
  opcoesDeAcao = {}
  vi.mocked(opcoesDoAgente).mockClear()
  agenda = null
  vi.mocked(lerAgendaDoAgente).mockClear()
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
      trechos: [
        { id: 't1', documentoId: 'doc-1', content: 'Horário: 9h às 18h.' },
        { id: 't2', documentoId: 'doc-1', content: 'Sábado: fechado.' },
      ],
      retrato: { blocos: [], documentos: ['doc-1'] },
    }
    const corpo = await (await enviar()).json()
    const args = vi.mocked(lerOQueOAgenteVe).mock.calls[0][1]
    expect(args).toMatchObject({ accountId: 'conta-1', contactId: null, dealId: null })
    // A consulta à base é a última mensagem do cliente SEM o rótulo da mídia.
    expect(args.consulta).toBe('quero pagar o boleto')
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toContain('[1] Horário: 9h às 18h.')
    // São os TRECHOS (2), não os documentos (1) — a tela diz "N trechos da base".
    expect(corpo.vistos).toEqual({ blocos: [], trechos: 2 })
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
    expect(corpo.vistos).toEqual({ blocos: ['cobrancas'], trechos: 0 })
  })

  it('bloco que saiu "indisponível" NÃO aparece como visto', async () => {
    visto = {
      blocos: [
        { bloco: 'ficha', texto: 'Customer record:\n- Name: Ana' },
        { bloco: 'cobrancas', texto: 'Billing (Asaas): unavailable right now.' },
      ],
      trechos: [],
      retrato: { blocos: [], documentos: [] },
    }
    const corpo = await (await enviar({ contactId: CONTATO })).json()
    expect(corpo.vistos).toEqual({ blocos: ['ficha'], trechos: 0 })
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

describe('POST /api/cb/ia/agentes/[id]/playground — as ações (F4, SIMULADAS)', () => {
  beforeEach(() => {
    opcoesDeAcao = {
      mover_etapa: [{ id: 'etapa-uuid', nome: 'Bancário · Proposta' }],
      etiquetar: [{ id: 'tag-uuid', nome: 'VIP' }],
      criar_tarefa: [{ id: 'membro-uuid', nome: 'Ana' }],
    }
  })

  it('o pedido lista as ações do agente, pela MESMA leitura do turno', async () => {
    agentes[ID] = agente(ID, { ferramentas: { etiquetar: { etiquetas: ['x'] } } })
    await enviar()
    expect(vi.mocked(opcoesDoAgente).mock.calls[0].slice(1)).toEqual(['conta-1', { etiquetar: { etiquetas: ['x'] } }])
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('[[MOVER:n]]')
    expect(pedido).toContain('1. Bancário · Proposta')
    expect(pedido).not.toContain('etapa-uuid')
  })

  it('⚠️ as aceitas voltam SIMULADAS — nada executa — e o marcador não aparece na resposta', async () => {
    resposta = { text: 'Pronto!\n[[MOVER:1]]\n[[ETIQUETAR:1]]\n[[TAREFA:1=Ligar amanhã]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.reply).toBe('Pronto!')
    expect(corpo.acoes).toEqual({
      aceitas: [
        { tipo: 'mover_etapa', nome: 'Bancário · Proposta' },
        { tipo: 'etiquetar', nome: 'VIP' },
        { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
      ],
      recusadas: [],
    })
    expect(corpo.linkInventado).toBe(false)
    expect(executarAcoes).not.toHaveBeenCalled()
  })

  it('número fora da lista (ou tipo não liberado) aparece como RECUSADO', async () => {
    resposta = { text: 'Ok\n[[ETIQUETAR:3]]\n[[AUTOMACAO:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.acoes).toEqual({
      aceitas: [],
      recusadas: [
        { tipo: 'etiquetar', motivo: 'fora_da_lista' },
        { tipo: 'executar_automacao', motivo: 'nao_liberada' },
      ],
    })
  })

  it('link inventado: a tela é avisada (no turno, a resposta seria retida) e as ações não executariam', async () => {
    resposta = { text: 'Pague em https://boleto.exemplo/1\n[[ETIQUETAR:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.linkInventado).toBe(true)
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'etiquetar', motivo: 'transferencia' }] })
  })

  it('link que veio do pedido (bloco de cobranças) não é inventado', async () => {
    visto = {
      blocos: [{ bloco: 'cobrancas', texto: 'Billing:\n- installment 1/3 — payment link: https://www.asaas.com/i/abc' }],
      trechos: [],
      retrato: { blocos: [], documentos: [] },
    }
    resposta = { text: 'Segue: https://www.asaas.com/i/abc', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.linkInventado).toBe(false)
  })

  it('só marcadores: transfere, como no turno (as ações vão para as recusadas)', async () => {
    resposta = { text: '[[MOVER:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: '', handoff: true })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'mover_etapa', motivo: 'transferencia' }] })
  })

  it('⚠️ o sentinela escrito de outro jeito (`[[ handoff ]]`) transfere, e vence a passagem', async () => {
    resposta = { text: 'Um momento. [[ handoff ]] [[PASSAR:1]]\n[[MOVER:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ handoff: true, passaPara: null })
    expect(corpo.reply).not.toMatch(/handoff/i)
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'mover_etapa', motivo: 'transferencia' }] })
  })

  it('"responda e passe" ([[TRANSFERIR]]): a resposta aparece SEM o marcador e a transferência vem como ação simulada', async () => {
    resposta = { text: 'Um especialista vai analisar o seu caso e te retorna por aqui.\n[[TRANSFERIR]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: 'Um especialista vai analisar o seu caso e te retorna por aqui.', handoff: false })
    expect(corpo.acoes).toEqual({ aceitas: [{ tipo: 'transferir', nome: '' }], recusadas: [] })
  })

  it('[[TRANSFERIR]] perde para o link inventado e para a resposta vazia (vai às recusadas)', async () => {
    resposta = { text: 'Pague em https://boleto.exemplo/1\n[[TRANSFERIR]]', handoff: false }
    const inventou = await (await enviar()).json()
    expect(inventou.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'transferir', motivo: 'transferencia' }] })
    resposta = { text: '[[TRANSFERIR]]', handoff: false }
    const vazio = await (await enviar()).json()
    expect(vazio).toMatchObject({ reply: '', handoff: true })
    expect(vazio.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'transferir', motivo: 'transferencia' }] })
  })

  it('a passagem vence: as ações vão para as recusadas (`passagem`)', async () => {
    resposta = { text: '[[PASSAR:1]]\n[[MOVER:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: '', passaPara: 'Cobrança' })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'mover_etapa', motivo: 'passagem' }] })
  })
})

describe('POST /api/cb/ia/agentes/[id]/playground — marcar reunião (F5)', () => {
  const TIPO = 'https://api.calendly.com/event_types/T1'
  // A forma de `opcoesDeHorario`: `nome` para gente, `textoNoPedido` para o modelo.
  const HORARIOS = [
    { id: '2026-09-28T18:15:00.000Z', nome: '28/09/2026 15:15', textoNoPedido: 'Mon 28/09 15:15' },
    { id: '2026-09-29T13:00:00.000Z', nome: '29/09/2026 10:00', textoNoPedido: 'Tue 29/09 10:00' },
  ]

  it('⚠️ os horários são lidos AO VIVO (a leitura do turno) e a reunião é SIMULADA — nada é marcado', async () => {
    agentes[ID] = agente(ID, { nome: 'Reagendamento', ferramentas: { marcar_reuniao: { tipos_de_evento: [TIPO] } } })
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Marquei para terça às 10h!\n[[REUNIÃO:2]]', handoff: false }
    const corpo = await (await enviar({ contactId: CONTATO })).json()
    const [, args] = vi.mocked(lerAgendaDoAgente).mock.calls[0]
    expect(args).toMatchObject({ accountId: 'conta-1', contactId: CONTATO, ferramentas: { marcar_reuniao: { tipos_de_evento: [TIPO] } } })
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('[[REUNIAO:n]]')
    expect(pedido).toContain('2. Tue 29/09 10:00')
    expect(corpo.reply).toBe('Marquei para terça às 10h!')
    // Na tela (em português), a data sem o dia da semana em inglês.
    expect(corpo.acoes).toEqual({ aceitas: [{ tipo: 'marcar_reuniao', nome: '29/09/2026 10:00' }], recusadas: [] })
    expect(corpo.horarios).toEqual([
      { n: 1, texto: '28/09/2026 15:15' },
      { n: 2, texto: '29/09/2026 10:00' },
    ])
    expect(marcarNoCalendly).not.toHaveBeenCalled()
    expect(executarAcoes).not.toHaveBeenCalled()
  })

  it('⚠️ a reunião PROMETIDA sem o marcador (27/09): `reuniaoPrometida`, e as ações não executariam', async () => {
    opcoesDeAcao = { mover_etapa: [{ id: 'etapa-1', nome: 'Comercial · Reunião' }] }
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Perfeito! Sua reunião está confirmada para terça-feira, 29/09, às 10:00.\n[[MOVER:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reuniaoPrometida: true, linkInventado: false, handoff: false })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'mover_etapa', motivo: 'transferencia' }] })
  })

  it('a mesma confirmação COM o marcador: não é prometida, a reunião vem simulada', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Perfeito! Sua reunião está confirmada para terça-feira, 29/09, às 10:00.\n[[REUNIAO:2]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.reuniaoPrometida).toBe(false)
    expect(corpo.acoes).toEqual({ aceitas: [{ tipo: 'marcar_reuniao', nome: '29/09/2026 10:00' }], recusadas: [] })
  })

  it('o nome completo no marcador (`[[REUNIAO:n=Nome]]`) vem na ação simulada', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Marquei para terça às 10h!\n[[REUNIAO:2=Maria Aparecida Souza]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.reply).toBe('Marquei para terça às 10h!')
    expect(corpo.acoes).toEqual({
      aceitas: [{ tipo: 'marcar_reuniao', nome: '29/09/2026 10:00', valor: 'Maria Aparecida Souza' }],
      recusadas: [],
    })
  })

  it('horário fora da lista: recusado', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Marquei!\n[[REUNIAO:7]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'marcar_reuniao', motivo: 'fora_da_lista' }] })
  })

  it('leitura que falhou: `horarios` nulo, e o pedido diz que não há horários agora; reunião desligada: nulo também', async () => {
    agenda = { tipoDeEvento: TIPO, lida: false, horarios: [], temEmail: false }
    const falhou = await (await enviar()).json()
    expect(falhou.horarios).toBeNull()
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toMatch(/not available right now/)
    agenda = null
    expect((await (await enviar()).json()).horarios).toBeNull()
  })

  it('cliente que JÁ tem reunião: nada oferecido (`horarios` nulo), o pedido manda o link dela, e o marcador é recusado', async () => {
    agenda = {
      tipoDeEvento: TIPO,
      lida: true,
      horarios: [],
      temEmail: true,
      reuniaoMarcada: { inicio: '2026-09-30T17:00:00Z', remarcar: 'https://calendly.com/reschedulings/vivo' },
    }
    resposta = { text: 'Marquei!\n[[REUNIAO:1]]', handoff: false }
    const corpo = await (await enviar({ contactId: CONTATO })).json()
    expect(corpo.horarios).toBeNull()
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toMatch(/already has a meeting booked/)
    expect(pedido).toContain('https://calendly.com/reschedulings/vivo')
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'marcar_reuniao', motivo: 'nao_liberada' }] })
  })

  it('lida e nenhum livre: lista VAZIA (não é falha)', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: [], temEmail: true }
    expect((await (await enviar()).json()).horarios).toEqual([])
  })
})
