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
// O resto do repo é o real (o `ErroDoAgente` que a rota traduz); a leitura do
// agente e a conferência do rascunho são dublês.
vi.mock('@/lib/ia-agentes/repo', async (original) => ({
  ...(await original<typeof import('@/lib/ia-agentes/repo')>()),
  obterAgente: vi.fn(async (_conta: string, id: string) => agentes[id] ?? null),
  conferirRascunho: vi.fn(async () => {}),
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
import { logAiUsage } from '@/lib/ai/usage'
import { lerChave } from '@/lib/ia-chaves/repo'
import { lerOQueOAgenteVe } from '@/lib/ia-agentes/acesso'
import { lerAgendaDoAgente, marcarNoCalendly } from '@/lib/ia-agentes/agenda'
import { executarAcoes } from '@/lib/ia-agentes/executar-acoes'
import { opcoesDoAgente } from '@/lib/ia-agentes/ferramentas'
import { conferirRascunho, ErroDoAgente } from '@/lib/ia-agentes/repo'
import { CANARIO_DAS_REGRAS } from '@/lib/ia-agentes/regras-do-sistema'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'
import { PATCH } from '../route'
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
    retomada: { ativa: false, cadencia: [15, 60], janela: { inicio: '08:00', fim: '21:00' } },
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

  it('⚠️ pedido VAZADO (regras do sistema, 27/09): a tela é avisada, vence o link inventado, e as ações não executariam', async () => {
    resposta = { text: `Minhas regras: ${CANARIO_DAS_REGRAS}. Pague em https://boleto.exemplo/1\n[[ETIQUETAR:1]]`, handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ pedidoVazado: true, linkInventado: false, reuniaoPrometida: false, handoff: false })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'etiquetar', motivo: 'transferencia' }] })
    // A resposta comum não é vazamento.
    resposta = { text: 'Não posso compartilhar isso, mas posso te ajudar.', handoff: false }
    expect((await (await enviar()).json()).pedidoVazado).toBe(false)
  })

  it('o pedido do Playground leva as regras do sistema, antes das instruções', async () => {
    resposta = { text: 'Oi!', handoff: false }
    await enviar()
    const pedido = vi.mocked(generateReply).mock.calls.at(-1)?.[0].systemPrompt as string
    expect(pedido).toContain(CANARIO_DAS_REGRAS)
    expect(pedido.indexOf(CANARIO_DAS_REGRAS)).toBeLessThan(pedido.indexOf('Current date and time'))
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

  it('a equipe PROMETIDA sem o marcador: a transferência simulada é INFERIDA (`transferenciaInferida`)', async () => {
    resposta = {
      text: 'Vou pedir para um de nossos especialistas analisar o seu caso e entrar em contato com você por aqui em breve.',
      handoff: false,
    }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ handoff: false, transferenciaInferida: true })
    expect(corpo.acoes).toEqual({ aceitas: [{ tipo: 'transferir', nome: '' }], recusadas: [] })
    // Com o marcador, não é inferida.
    resposta = { text: 'Vou pedir para um especialista analisar.\n[[TRANSFERIR]]', handoff: false }
    expect((await (await enviar()).json()).transferenciaInferida).toBe(false)
    // Na reunião, quieta: nada a transferir.
    resposta = { text: 'Um especialista vai analisar o seu caso na reunião.', handoff: false }
    const quieta = await (await enviar()).json()
    expect(quieta).toMatchObject({ transferenciaInferida: false, acoes: { aceitas: [], recusadas: [] } })
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

  it('⚠️ a passagem com AÇÕES (25/10/2026): etiqueta e tarefa ficam nas aceitas (no turno, rodam antes de passar); mover vai às recusadas', async () => {
    resposta = { text: '[[PASSAR:1]]\n[[ETIQUETAR:1]]\n[[MOVER:1]]\n[[TAREFA:1=Ligar amanhã]]\n[[TRANSFERIR]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ reply: '', passaPara: 'Cobrança', handoff: false })
    expect(corpo.acoes).toEqual({
      aceitas: [
        { tipo: 'etiquetar', nome: 'VIP' },
        { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
      ],
      recusadas: [
        { tipo: 'mover_etapa', motivo: 'passagem' },
        { tipo: 'transferir', motivo: 'passagem' },
      ],
    })
    expect(executarAcoes).not.toHaveBeenCalled()
  })

  it('a passagem INVÁLIDA (número que não existe) transfere: nada executaria', async () => {
    resposta = { text: '[[PASSAR:7]]\n[[ETIQUETAR:1]]', handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ handoff: true, passaPara: null })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'etiquetar', motivo: 'transferencia' }] })
  })

  it('⚠️ a AÇÃO PROMETIDA sem a ação (25/10/2026, a frase medida): `acaoPrometida`, e as ações não executariam', async () => {
    const MEDIDO = 'Criei o lembrete para o Leonardo te enviar a lista de documentos na quarta-feira.'
    resposta = { text: `${MEDIDO}\n[[ETIQUETAR:1]]`, handoff: false }
    const corpo = await (await enviar()).json()
    expect(corpo).toMatchObject({ acaoPrometida: true, reuniaoPrometida: false, linkInventado: false, handoff: false })
    expect(corpo.acoes).toEqual({ aceitas: [], recusadas: [{ tipo: 'etiquetar', motivo: 'transferencia' }] })
    // Com a tarefa aceita, cumpre: sai, e a tarefa vem simulada.
    resposta = { text: `${MEDIDO}\n[[TAREFA:1=Enviar a lista]]`, handoff: false }
    const comTarefa = await (await enviar()).json()
    expect(comTarefa.acaoPrometida).toBe(false)
    expect(comTarefa.acoes.aceitas).toEqual([{ tipo: 'criar_tarefa', nome: 'Ana', valor: 'Enviar a lista' }])
  })

  it('a afirmação que repete uma resposta ANTERIOR do agente no teste não é prometida', async () => {
    resposta = { text: 'Sim, já registrei suas informações no sistema.', handoff: false }
    const mensagens = [
      { role: 'user', content: 'Meu nome é Ana' },
      { role: 'assistant', content: 'Registrei suas informações no sistema!' },
      { role: 'user', content: 'Registrou mesmo?' },
    ]
    expect((await (await enviar({ messages: mensagens })).json()).acaoPrometida).toBe(false)
    expect((await (await enviar({ messages: [{ role: 'user', content: 'Registrou?' }] })).json()).acaoPrometida).toBe(true)
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

  it('o nome completo no marcador (`[[REUNIAO:n=Nome]]`) vem na ação simulada — quando o CLIENTE o escreveu', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Marquei para terça às 10h!\n[[REUNIAO:2=Maria Aparecida Souza]]', handoff: false }
    const mensagens = [{ role: 'user', content: 'Meu nome completo é maria aparecida de souza, pode ser terça 10h' }]
    const corpo = await (await enviar({ messages: mensagens })).json()
    expect(corpo.reply).toBe('Marquei para terça às 10h!')
    expect(corpo.acoes).toEqual({
      aceitas: [{ tipo: 'marcar_reuniao', nome: '29/09/2026 10:00', valor: 'Maria Aparecida Souza' }],
      recusadas: [],
    })
  })

  it('⚠️ o nome SEM origem na conversa (Codex, #321) cai: a reunião simulada vai sem ele', async () => {
    agenda = { tipoDeEvento: TIPO, lida: true, horarios: HORARIOS, temEmail: true }
    resposta = { text: 'Marquei para terça às 10h!\n[[REUNIAO:2=Dr. Silva]]', handoff: false }
    const corpo = await (await enviar({ messages: [{ role: 'user', content: 'Pode ser terça às 10h' }] })).json()
    expect(corpo.acoes).toEqual({ aceitas: [{ tipo: 'marcar_reuniao', nome: '29/09/2026 10:00' }], recusadas: [] })
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

describe('POST /api/cb/ia/agentes/[id]/playground — "Simular retomada" (1056)', () => {
  const CONVERSA = [
    { role: 'user', content: 'Quero revisar meu contrato' },
    { role: 'assistant', content: 'Claro! Você conseguiu separar os extratos?' },
  ]
  const retomada = { ativa: false, cadencia: [15, 60, 180], janela: { inicio: '08:00', fim: '21:00' } }

  function simular(extra: Record<string, unknown> = {}, messages: unknown = CONVERSA) {
    return POST(
      new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, {
        method: 'POST',
        body: JSON.stringify({ messages, retomada: true, ...extra }),
      }),
      { params: Promise.resolve({ id: ID }) },
    )
  }

  beforeEach(() => {
    agentes[ID] = agente(ID, { nome: 'Triagem', podePassarPara: ['cobranca'], retomada })
  })

  it('a conversa tem de terminar na resposta do AGENTE (senão 400 retomada_sem_resposta)', async () => {
    const res = await simular({}, [{ role: 'user', content: 'oi' }])
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'retomada_sem_resposta' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('sem a flag, a conversa que termina no agente continua sendo 400 sem_mensagens', async () => {
    const res = await POST(
      new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, { method: 'POST', body: JSON.stringify({ messages: CONVERSA }) }),
      { params: Promise.resolve({ id: ID }) },
    )
    expect(await res.json()).toMatchObject({ code: 'sem_mensagens' })
  })

  it('gera com a seção da retomada (a tentativa e o tempo da cadência), sem ações, passagens nem horários — e nada é enviado', async () => {
    resposta = { text: 'Oi! Conseguiu separar os extratos?', handoff: false }
    const corpo = await (await simular({ tentativa: 2 })).json()
    expect(corpo.retomada).toEqual({
      tentativa: 2,
      de: 3,
      texto: 'Oi! Conseguiu separar os extratos?',
      parada: null,
      // A retomada deste agente está desligada: a simulação roda e diz isso.
      desligada: true,
    })
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('the customer has not replied for 1 hour. This is follow-up 2 of 3.')
    expect(pedido).not.toContain('[[PASSAR:n]]')
    expect(opcoesDoAgente).not.toHaveBeenCalled()
    expect(lerAgendaDoAgente).not.toHaveBeenCalled()
    expect(executarAcoes).not.toHaveBeenCalled()
  })

  it('a tentativa fica dentro da cadência (acima = a última; ilegível = a 1ª)', async () => {
    expect((await (await simular({ tentativa: 9 })).json()).retomada).toMatchObject({ tentativa: 3, de: 3 })
    expect((await (await simular({ tentativa: 'x' })).json()).retomada).toMatchObject({ tentativa: 1 })
  })

  it.each<[string, { text: string; handoff: boolean }, string]>([
    ['[[SEM_RETOMADA]]', { text: '[[SEM_RETOMADA]]', handoff: false }, 'nada_pendente'],
    ['[[HANDOFF]]', { text: '', handoff: true }, 'pediu_equipe'],
    ['link inventado', { text: 'Veja: https://inventado.example', handoff: false }, 'link_inventado'],
  ])('%s: nada sairia, e a resposta diz por quê', async (_rotulo, gerada, parada) => {
    resposta = gerada
    const corpo = await (await simular()).json()
    expect(corpo.retomada).toMatchObject({ texto: '', parada })
  })
})

describe('POST /api/cb/ia/agentes/[id]/playground — o RASCUNHO da tela (DC4, 26/10/2026)', () => {
  const OUTRO = '55555555-5555-4555-8555-555555555555'

  beforeEach(() => {
    agentes[ID] = agente(ID, { nome: 'Triagem', instrucoes: 'INSTRUCAO SALVA', modelo: 'modelo-salvo' })
    vi.mocked(conferirRascunho).mockReset()
    vi.mocked(conferirRascunho).mockResolvedValue(undefined)
  })

  it('⚠️ a instrução do rascunho chega ao systemPrompt (e a salva não), sem salvar nada', async () => {
    const res = await enviar({ rascunho: { instrucoes: 'INSTRUCAO DO RASCUNHO', regras: ['REGRA DO RASCUNHO'] } })
    expect(res.status).toBe(200)
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('INSTRUCAO DO RASCUNHO')
    expect(pedido).toContain('REGRA DO RASCUNHO')
    expect(pedido).not.toContain('INSTRUCAO SALVA')
    // Conferido COMO no salvar: o agente salvo e o rascunho lido por `lerAlteracao`.
    expect(vi.mocked(conferirRascunho).mock.calls[0]).toEqual([
      'conta-1',
      agentes[ID],
      { instrucoes: 'INSTRUCAO DO RASCUNHO', regras: ['REGRA DO RASCUNHO'] },
    ])
  })

  it('sem rascunho, testa o SALVO e não confere nada', async () => {
    await enviar()
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toContain('INSTRUCAO SALVA')
    expect(conferirRascunho).not.toHaveBeenCalled()
  })

  it('o provedor e o modelo do rascunho geram — a chave lida é a do provedor do rascunho; o uso fica no agente, com o nome SALVO', async () => {
    await enviar({ rascunho: { provedor: 'gemini', modelo: 'modelo-do-rascunho', nome: 'Nome novo' } })
    const config = vi.mocked(generateReply).mock.calls[0][0].config
    expect(config).toMatchObject({ provider: 'gemini', model: 'modelo-do-rascunho' })
    expect(vi.mocked(lerChave).mock.calls.at(-1)).toEqual(['conta-1', 'gemini'])
    expect(vi.mocked(logAiUsage).mock.calls[0][1]).toMatchObject({
      mode: 'agente_teste',
      provider: 'gemini',
      model: 'modelo-do-rascunho',
      iaAgenteId: ID,
      iaAgenteNome: 'Triagem',
    })
  })

  it('as passagens do rascunho entram no pedido', async () => {
    agentes[OUTRO] = agente(OUTRO, { nome: 'Cobrança do rascunho' })
    await enviar({ rascunho: { pode_passar_para: [OUTRO] } })
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toContain('1. Cobrança do rascunho')
  })

  it.each<[string, Record<string, unknown>]>([
    ['lista_invalida', { regras: 'não é lista' }],
    ['teto_invalido', { teto_respostas: 0 }],
    ['modelo_vazio', { provedor: 'openai' }],
    ['retomada_invalida', { retomada: { ativa: true, cadencia: [], janela: { inicio: '08:00', fim: '21:00' } } }],
    ['corpo_invalido', [] as unknown as Record<string, unknown>],
  ])('rascunho fora da forma (%s): o MESMO 400 do PATCH, sem gerar', async (codigo, rascunho) => {
    const res = await enviar({ rascunho })
    expect(res.status).toBe(400)
    // A marca de que o erro é do RASCUNHO (o corpo continua o do PATCH).
    expect(res.headers.get('x-rascunho-recusado')).toBe('1')
    const corpo = await res.json()
    expect(corpo).toMatchObject({ code: codigo })
    const doSalvar = await PATCH(
      new Request(`http://x/api/cb/ia/agentes/${ID}`, { method: 'PATCH', body: JSON.stringify(rascunho) }),
      { params: Promise.resolve({ id: ID }) },
    )
    expect(doSalvar.status).toBe(400)
    expect(await doSalvar.json()).toEqual(corpo)
    expect(generateReply).not.toHaveBeenCalled()
    expect(conferirRascunho).not.toHaveBeenCalled()
  })

  it.each([
    ['item de outra conta', 'item_de_outra_conta'],
    ['campo vigiado', 'campo_vigiado'],
    ['automação fora da D5', 'automacao_fora_da_d5'],
  ] as const)('⚠️ %s: o MESMO 400 do salvar (código e `itens`), sem gerar nem gastar', async (_rotulo, codigo) => {
    const erro = new ErroDoAgente(codigo, 'ferramenta recusada', undefined, [OUTRO])
    vi.mocked(conferirRascunho).mockRejectedValue(erro)
    const res = await enviar({ rascunho: { ferramentas: { etiquetar: { etiquetas: [OUTRO] } } } })
    expect(res.status).toBe(400)
    expect(res.headers.get('x-rascunho-recusado')).toBe('1')
    const corpo = await res.json()
    expect(corpo).toEqual({ error: codigo, code: codigo, itens: [OUTRO] })
    // O que o PATCH devolveria com a mesma recusa.
    expect(corpo).toEqual(await respostaDoErro(erro)!.json())
    expect(generateReply).not.toHaveBeenCalled()
    expect(logAiUsage).not.toHaveBeenCalled()
  })

  it('provedor do rascunho sem chave: o mesmo `provedor_sem_chave` do salvar', async () => {
    vi.mocked(conferirRascunho).mockRejectedValue(new ErroDoAgente('provedor_sem_chave', 'sem chave'))
    const res = await enviar({ rascunho: { provedor: 'openai', modelo: 'gpt-x' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'provedor_sem_chave' })
  })

  it('o 400 que NÃO é do rascunho (sem chave do provedor salvo, conversa sem cliente) não leva a marca', async () => {
    vi.mocked(lerChave).mockResolvedValueOnce({ chave: null, ilegivel: false })
    const semChave = await enviar({ rascunho: { instrucoes: 'Nova.' } })
    expect(semChave.status).toBe(400)
    expect(await semChave.json()).toMatchObject({ code: 'sem_chave' })
    expect(semChave.headers.get('x-rascunho-recusado')).toBeNull()
    const semCliente = await enviar({ messages: [{ role: 'assistant', content: 'oi' }], rascunho: { instrucoes: 'Nova.' } })
    expect(semCliente.status).toBe(400)
    expect(semCliente.headers.get('x-rascunho-recusado')).toBeNull()
  })

  it('erro de BANCO na conferência do rascunho é 500, nunca "recusado"', async () => {
    vi.mocked(conferirRascunho).mockRejectedValue(new ErroDoAgente('banco', 'timeout'))
    const res = await enviar({ rascunho: { ferramentas: { etiquetar: { etiquetas: [OUTRO] } } } })
    expect(res.status).toBe(500)
    expect(res.headers.get('x-rascunho-recusado')).toBeNull()
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('`rascunho: null` é o mesmo que sem rascunho', async () => {
    const res = await enviar({ rascunho: null })
    expect(res.status).toBe(200)
    expect(conferirRascunho).not.toHaveBeenCalled()
  })
})

describe('POST /api/cb/ia/agentes/[id]/playground — "Ver o pedido enviado" (sob demanda)', () => {
  it('com `verPedido: true`, a resposta traz o texto EXATO que foi ao modelo; sem ele, não', async () => {
    const com = await (await enviar({ verPedido: true })).json()
    expect(com.pedido).toBe(vi.mocked(generateReply).mock.calls[0][0].systemPrompt)
    const sem = await (await enviar()).json()
    expect(sem).not.toHaveProperty('pedido')
    // Só o booleano true liga.
    expect(await (await enviar({ verPedido: 'true' })).json()).not.toHaveProperty('pedido')
  })

  it('na retomada simulada também', async () => {
    resposta = { text: 'Oi! Conseguiu?', handoff: false }
    const res = await POST(
      new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, {
        method: 'POST',
        body: JSON.stringify({
          messages: [
            { role: 'user', content: 'oi' },
            { role: 'assistant', content: 'Pode me mandar os extratos?' },
          ],
          retomada: true,
          verPedido: true,
        }),
      }),
      { params: Promise.resolve({ id: ID }) },
    )
    const corpo = await res.json()
    expect(corpo.pedido).toBe(vi.mocked(generateReply).mock.calls[0][0].systemPrompt)
  })
})

describe('POST /api/cb/ia/agentes/[id]/playground — a retomada do RASCUNHO (DC4)', () => {
  const CONVERSA = [
    { role: 'user', content: 'Quero revisar meu contrato' },
    { role: 'assistant', content: 'Você conseguiu separar os extratos?' },
  ]
  function simular(extra: Record<string, unknown> = {}) {
    return POST(
      new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, {
        method: 'POST',
        body: JSON.stringify({ messages: CONVERSA, retomada: true, ...extra }),
      }),
      { params: Promise.resolve({ id: ID }) },
    )
  }

  beforeEach(() => {
    vi.mocked(conferirRascunho).mockReset()
    vi.mocked(conferirRascunho).mockResolvedValue(undefined)
    resposta = { text: 'Oi! Conseguiu separar?', handoff: false }
  })

  it('⚠️ diz quando a retomada está DESLIGADA na versão testada (e simula assim mesmo)', async () => {
    const salva = await (await simular()).json()
    expect(salva.retomada).toMatchObject({ tentativa: 1, de: 2, parada: null, desligada: true })
    const ligadaNoRascunho = await (
      await simular({ rascunho: { retomada: { ativa: true, cadencia: [15, 60, 180], janela: { inicio: '08:00', fim: '21:00' } } } })
    ).json()
    // A cadência do RASCUNHO (3 tentativas), ligada.
    expect(ligadaNoRascunho.retomada).toMatchObject({ de: 3, desligada: false })
  })

  it('a tentativa vem da cadência do rascunho (o tempo sem resposta é o intervalo dela)', async () => {
    await simular({
      tentativa: 2,
      rascunho: { retomada: { ativa: true, cadencia: [30, 240], janela: { inicio: '08:00', fim: '21:00' } } },
    })
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string
    expect(pedido).toContain('the customer has not replied for 4 hours. This is follow-up 2 of 2.')
  })

  it('a instrução do rascunho também chega ao pedido da retomada', async () => {
    await simular({ rascunho: { instrucoes: 'INSTRUCAO DO RASCUNHO NA RETOMADA' } })
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).toContain('INSTRUCAO DO RASCUNHO NA RETOMADA')
  })
})
