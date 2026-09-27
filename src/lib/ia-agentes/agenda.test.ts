import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// O token é lido cifrado; aqui ele é o que está gravado (e nunca vai a rede nenhuma).
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => {
    if (v === 'ilegivel') throw new Error('bad decrypt')
    return v
  },
}))

import { CalendlyError, type ClienteCalendly, type TipoDeEvento } from '@/lib/calendly/cliente'

import { emailDoCliente, lerAgendaDoAgente, marcarNoCalendly, tiposDeEventoAtivos, tiposDeEventoParaATela } from './agenda'

// ============================================================
// A AGENDA do agente no Calendly (F5). O banco é FALSO, em memória; o
// Calendly é um DUBLÊ — nenhuma chamada de rede. O que estes testes seguram:
//  - a conexão é DESTA conta, e sem ela o Calendly está "desconectado";
//  - a tela recebe só os tipos ATIVOS, e falha vira "falhou", nunca lista vazia;
//  - os horários do pedido têm PRAZO: estourou = "não lidos", sem derrubar;
//  - o e-mail: o da ficha, senão o do último agendamento; nenhum = sem_email;
//  - o `POST /invitees` leva o corpo esperado (nome, e-mail, fuso, telefone,
//    local do tipo de evento), no horário escolhido;
//  - a recusa de horário tomado, a rede e o token recusado viram códigos.
// ============================================================

type Linha = Record<string, unknown>

interface Banco {
  tabelas: Record<string, Linha[]>
  falhas: Set<string>
  consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }>
}

let banco: Banco

const db = {
  from(tabela: string) {
    const filtros: Array<[string, unknown]> = []
    const depois: Array<(l: Linha) => boolean> = []
    let ordem: { coluna: string; asc: boolean } | null = null
    let limite: number | null = null
    const executar = () => {
      banco.consultas.push({ tabela, filtros })
      if (banco.falhas.has(tabela)) return { data: null, error: { message: `${tabela} fora do ar` } }
      let linhas = (banco.tabelas[tabela] ?? []).filter(
        (l) => filtros.every(([c, v]) => l[c] === v) && depois.every((f) => f(l)),
      )
      if (ordem) {
        const { coluna, asc } = ordem
        linhas = [...linhas].sort((a, b) => (String(a[coluna]) < String(b[coluna]) ? -1 : 1) * (asc ? 1 : -1))
      }
      if (limite !== null) linhas = linhas.slice(0, limite)
      return { data: linhas.map((l) => ({ ...l })), error: null }
    }
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      gt: (c: string, v: string) => (depois.push((l) => String(l[c]) > v), q),
      in: (c: string, vs: unknown[]) => (depois.push((l) => vs.includes(l[c])), q),
      order: (c: string, o?: { ascending?: boolean }) => ((ordem = { coluna: c, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      maybeSingle: async () => {
        const r = executar()
        return r.error ? r : { data: (r.data as Linha[])[0] ?? null, error: null }
      },
      then: (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, erro),
    }
    return q
  },
} as unknown as SupabaseClient

const CONTA = 'conta-1'
const CONTATO = 'contato-1'
const TIPO = 'https://api.calendly.com/event_types/T1'

function tipo(p: Partial<TipoDeEvento> = {}): TipoDeEvento {
  return { uri: TIPO, nome: 'Reunião', ativo: true, schedulingUrl: null, duracao: 30, local: 'google_conference', perguntas: [], ...p }
}

/** Um dublê do cliente do Calendly: cada método é um `vi.fn` que o teste ajusta. */
function dubleDoCalendly() {
  const cliente = {
    tiposDeEvento: vi.fn(async (): Promise<TipoDeEvento[]> => [tipo(), tipo({ uri: `${TIPO}X`, nome: 'Antigo', ativo: false })]),
    tipoDeEvento: vi.fn(async () => tipo()),
    horariosLivres: vi.fn(async () => ['2026-09-29T13:00:00Z', '2026-09-28T18:15:00Z']),
    criarConvidado: vi.fn(async () => ({ uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1' })),
  }
  const tokens: string[] = []
  const fabrica = (token: string) => {
    tokens.push(token)
    return cliente as unknown as ClienteCalendly
  }
  return { cliente, fabrica, tokens }
}

let calendly: ReturnType<typeof dubleDoCalendly>

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  calendly = dubleDoCalendly()
  banco = {
    tabelas: {
      cb_calendly_config: [
        { account_id: CONTA, access_token: 'token-da-conta', user_uri: 'https://api.calendly.com/users/U1', organization_uri: 'https://api.calendly.com/organizations/O1' },
        { account_id: 'outra', access_token: 'token-de-outra', user_uri: 'u', organization_uri: 'o' },
      ],
      contacts: [
        { id: CONTATO, account_id: CONTA, name: 'Maria Souza', phone: '5511999998888', email: 'maria@exemplo.com' },
        { id: 'sem-nome', account_id: CONTA, name: null, phone: '5511888887777', email: 'joao@exemplo.com' },
        { id: 'sem-email', account_id: CONTA, name: 'Ana', phone: '5511777776666', email: null },
      ],
      cb_calendly_eventos: [],
    },
    falhas: new Set(),
    consultas: [],
  }
})

describe('tiposDeEventoAtivos / tiposDeEventoParaATela', () => {
  it('a conexão DESTA conta: só os ativos, da organização', async () => {
    const r = await tiposDeEventoAtivos(db, CONTA, { cliente: calendly.fabrica })
    expect(r).toEqual({ estado: 'conectado', tipos: [tipo()] })
    expect(calendly.tokens).toEqual(['token-da-conta'])
    expect(calendly.cliente.tiposDeEvento).toHaveBeenCalledWith({ organization: 'https://api.calendly.com/organizations/O1' })
  })

  it('token sem acesso à organização (403): os do próprio usuário', async () => {
    calendly.cliente.tiposDeEvento
      .mockRejectedValueOnce(new CalendlyError('sem_permissao', '403: Forbidden', 403))
      .mockResolvedValueOnce([tipo()])
    const r = await tiposDeEventoAtivos(db, CONTA, { cliente: calendly.fabrica })
    expect(r).toEqual({ estado: 'conectado', tipos: [tipo()] })
    expect(calendly.cliente.tiposDeEvento).toHaveBeenLastCalledWith({ user: 'https://api.calendly.com/users/U1' })
  })

  it('sem conexão, token recusado (401) ou que não decifra: desconectado', async () => {
    expect(await tiposDeEventoAtivos(db, 'conta-sem', { cliente: calendly.fabrica })).toEqual({ estado: 'desconectado' })
    calendly.cliente.tiposDeEvento.mockRejectedValueOnce(new CalendlyError('token_invalido', '401', 401))
    expect(await tiposDeEventoAtivos(db, CONTA, { cliente: calendly.fabrica })).toEqual({ estado: 'desconectado' })
    banco.tabelas.cb_calendly_config[0].access_token = 'ilegivel'
    expect(await tiposDeEventoAtivos(db, CONTA, { cliente: calendly.fabrica })).toEqual({ estado: 'desconectado' })
  })

  it('erro de BANCO lança (nunca "desconectado")', async () => {
    banco.falhas.add('cb_calendly_config')
    await expect(tiposDeEventoAtivos(db, CONTA, { cliente: calendly.fabrica })).rejects.toThrow(/fora do ar/)
  })

  it('a tela: conectado com { uri, nome, duracao }; falha = "falhou" e `null`, nunca lista vazia', async () => {
    expect(await tiposDeEventoParaATela(db, CONTA, { cliente: calendly.fabrica })).toEqual({
      calendly: 'conectado',
      tiposDeEvento: [{ uri: TIPO, nome: 'Reunião', duracao: 30 }],
    })
    expect(await tiposDeEventoParaATela(db, 'conta-sem', { cliente: calendly.fabrica })).toEqual({
      calendly: 'desconectado',
      tiposDeEvento: null,
    })
    calendly.cliente.tiposDeEvento.mockRejectedValueOnce(new CalendlyError('rede', 'ECONNRESET'))
    expect(await tiposDeEventoParaATela(db, CONTA, { cliente: calendly.fabrica })).toEqual({
      calendly: 'falhou',
      tiposDeEvento: null,
    })
    banco.falhas.add('cb_calendly_config')
    expect(await tiposDeEventoParaATela(db, CONTA, { cliente: calendly.fabrica })).toEqual({
      calendly: 'falhou',
      tiposDeEvento: null,
    })
  })

  it('⚠️ a tela tem PRAZO: o Calendly que não responde vira "falhou" em ~prazo, sem segurar o resto', async () => {
    calendly.cliente.tiposDeEvento.mockImplementation(() => new Promise(() => {}))
    const inicio = Date.now()
    expect(await tiposDeEventoParaATela(db, CONTA, { cliente: calendly.fabrica }, 40)).toEqual({
      calendly: 'falhou',
      tiposDeEvento: null,
    })
    expect(Date.now() - inicio).toBeLessThan(1_500)
  })
})

describe('emailDoCliente', () => {
  it('o da FICHA primeiro', async () => {
    expect(await emailDoCliente(db, CONTA, CONTATO)).toBe('maria@exemplo.com')
  })

  it('sem e-mail na ficha: o do ÚLTIMO agendamento do contato (a coluna, senão a variável)', async () => {
    banco.tabelas.cb_calendly_eventos = [
      { account_id: CONTA, contact_id: 'sem-email', evento: 'invitee.created', recebido_em: '2026-09-01T00:00:00Z', email: 'velho@x.com', variaveis: {} },
      { account_id: CONTA, contact_id: 'sem-email', evento: 'invitee.created', recebido_em: '2026-09-20T00:00:00Z', email: null, variaveis: { agendamento_email: 'novo@x.com' } },
      { account_id: CONTA, contact_id: 'sem-email', evento: 'invitee.canceled', recebido_em: '2026-09-25T00:00:00Z', email: 'cancelado@x.com', variaveis: {} },
      { account_id: 'outra', contact_id: 'sem-email', evento: 'invitee.created', recebido_em: '2026-09-26T00:00:00Z', email: 'de-outra@x.com', variaveis: {} },
    ]
    expect(await emailDoCliente(db, CONTA, 'sem-email')).toBe('novo@x.com')
  })

  it('nenhum = null; e-mail sem forma de e-mail não serve', async () => {
    expect(await emailDoCliente(db, CONTA, 'sem-email')).toBeNull()
    banco.tabelas.contacts[2].email = 'ana arroba x'
    expect(await emailDoCliente(db, CONTA, 'sem-email')).toBeNull()
  })

  it('erro de banco LANÇA (não é "sem e-mail")', async () => {
    banco.falhas.add('contacts')
    await expect(emailDoCliente(db, CONTA, CONTATO)).rejects.toThrow(/contacts fora do ar/)
  })
})

describe('lerAgendaDoAgente — os horários do pedido', () => {
  const ferramentas = { marcar_reuniao: { tipos_de_evento: [TIPO] } }
  const agora = new Date('2026-09-26T12:00:00Z')

  it('reunião desligada: null, sem ler nada', async () => {
    expect(await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas: {}, contactId: CONTATO, agora }, { cliente: calendly.fabrica })).toBeNull()
    expect(banco.consultas).toHaveLength(0)
    expect(calendly.cliente.horariosLivres).not.toHaveBeenCalled()
  })

  it('os horários do tipo liberado, na janela, numerados em ordem, com o e-mail do cliente', async () => {
    const r = await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica })
    expect(r).toEqual({
      tipoDeEvento: TIPO,
      lida: true,
      horarios: [
        { id: '2026-09-28T18:15:00.000Z', nome: '28/09/2026 15:15', textoNoPedido: 'Mon 28/09 15:15' },
        { id: '2026-09-29T13:00:00.000Z', nome: '29/09/2026 10:00', textoNoPedido: 'Tue 29/09 10:00' },
      ],
      temEmail: true,
      reuniaoMarcada: null,
    })
    expect(calendly.cliente.horariosLivres).toHaveBeenCalledWith(
      { tipoDeEvento: TIPO, inicio: '2026-09-26T13:00:00.000Z', fim: '2026-10-03T12:59:00.000Z' },
      { prazoMs: 4_000 },
    )
  })

  it('⚠️ PRAZO: o Calendly que não responde vira "não lidos" em ~prazo, sem derrubar', async () => {
    calendly.cliente.horariosLivres.mockImplementation(() => new Promise(() => {}))
    const inicio = Date.now()
    const r = await lerAgendaDoAgente(
      db,
      { accountId: CONTA, ferramentas, contactId: CONTATO, agora, prazoMs: 40 },
      { cliente: calendly.fabrica },
    )
    expect(Date.now() - inicio).toBeLessThan(1_500)
    expect(r).toEqual({ tipoDeEvento: TIPO, lida: false, horarios: [], temEmail: true, reuniaoMarcada: null })
  })

  it('falha do Calendly, desconectado ou token que não decifra: "não lidos"', async () => {
    calendly.cliente.horariosLivres.mockRejectedValueOnce(new CalendlyError('calendly_error', '500: erro', 500))
    expect((await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica }))?.lida).toBe(false)
    expect((await lerAgendaDoAgente(db, { accountId: 'conta-sem', ferramentas, contactId: null, agora }, { cliente: calendly.fabrica }))?.lida).toBe(false)
    banco.tabelas.cb_calendly_config[0].access_token = 'ilegivel'
    expect((await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica }))?.lida).toBe(false)
  })

  it('⚠️ cliente que JÁ tem reunião futura: NENHUM horário, com a data e o link de remarcar DELA (a leitura do bloco "reuniao")', async () => {
    banco.tabelas.cb_calendly_eventos = [
      // A passada não conta; a cancelada (reagendada) também não; a viva, sim.
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'I0', inicio: '2026-09-20T13:00:00Z', event_type_nome: 'R', variaveis: {} },
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'I1', inicio: '2026-09-29T13:00:00Z', event_type_nome: 'R', variaveis: { agendamento_remarcar: 'https://calendly.com/reschedulings/velho' } },
      { account_id: CONTA, contact_id: null, evento: 'invitee.canceled', invitee_uri: 'I1', inicio: '2026-09-29T13:00:00Z' },
      { account_id: CONTA, contact_id: CONTATO, evento: 'invitee.created', invitee_uri: 'I2', inicio: '2026-09-30T17:00:00Z', event_type_nome: 'R', variaveis: { agendamento_remarcar: 'https://calendly.com/reschedulings/vivo' } },
    ]
    const r = await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica })
    expect(r).toEqual({
      tipoDeEvento: TIPO,
      lida: true,
      horarios: [],
      temEmail: true,
      reuniaoMarcada: { inicio: '2026-09-30T17:00:00Z', remarcar: 'https://calendly.com/reschedulings/vivo' },
    })
  })

  it('a leitura da reunião já marcada FALHA: nenhum horário (`lida` falso) — na dúvida, não marcar por cima', async () => {
    banco.falhas.add('cb_calendly_eventos')
    const r = await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica })
    expect(r).toMatchObject({ lida: false, horarios: [], reuniaoMarcada: null })
  })

  it('sem contato (Playground sem contato), ou leitura do e-mail que falha: `temEmail` falso', async () => {
    expect((await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: null, agora }, { cliente: calendly.fabrica }))?.temEmail).toBe(false)
    banco.falhas.add('contacts')
    const r = await lerAgendaDoAgente(db, { accountId: CONTA, ferramentas, contactId: CONTATO, agora }, { cliente: calendly.fabrica })
    expect(r).toMatchObject({ lida: true, temEmail: false })
  })
})

describe('marcarNoCalendly — o POST /invitees', () => {
  const args = { accountId: CONTA, contactId: CONTATO, tipoDeEvento: TIPO, inicio: '2026-09-28T18:15:00.000Z' }

  it('⚠️ o corpo esperado: tipo, horário escolhido, nome e e-mail da ficha, fuso do escritório, telefone com +, local do tipo', async () => {
    const r = await marcarNoCalendly(db, args, { cliente: calendly.fabrica })
    expect(r).toEqual({ ok: true, uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1' })
    expect(calendly.cliente.tipoDeEvento).toHaveBeenCalledWith(TIPO)
    expect(calendly.cliente.criarConvidado).toHaveBeenCalledTimes(1)
    const [corpo, opcoes] = calendly.cliente.criarConvidado.mock.calls[0] as unknown as [Record<string, unknown>, { prazoMs: number }]
    expect(corpo).toEqual({
      event_type: TIPO,
      start_time: '2026-09-28T18:15:00.000Z',
      invitee: {
        name: 'Maria Souza',
        email: 'maria@exemplo.com',
        timezone: 'America/Sao_Paulo',
        text_reminder_number: '+5511999998888',
      },
      location: { kind: 'google_conference' },
    })
    expect(opcoes.prazoMs).toBeGreaterThan(0)
    expect(calendly.tokens).toEqual(['token-da-conta'])
  })

  it('⚠️ o telefone vai como RESPOSTA da pergunta de telefone do tipo de evento (a forma medida) — é por ela que o webhook acha o cliente', async () => {
    calendly.cliente.tipoDeEvento.mockResolvedValueOnce(
      tipo({ perguntas: [{ nome: 'Telefone (Whatsapp)', tipo: 'phone_number', obrigatoria: true, posicao: 0, ativa: true }] }),
    )
    await marcarNoCalendly(db, args, { cliente: calendly.fabrica })
    const [corpo] = calendly.cliente.criarConvidado.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(corpo.questions_and_answers).toEqual([{ question: 'Telefone (Whatsapp)', answer: '+5511999998888', position: 0 }])
  })

  it('a pergunta CONFIGURADA no cartão do Calendly (`pergunta_telefone`) é a respondida', async () => {
    banco.tabelas.cb_calendly_config[0].pergunta_telefone = 'contato para'
    calendly.cliente.tipoDeEvento.mockResolvedValueOnce(
      tipo({
        perguntas: [
          { nome: 'Empresa', tipo: 'string', obrigatoria: false, posicao: 0, ativa: true },
          { nome: 'Contato para a reunião', tipo: 'string', obrigatoria: true, posicao: 1, ativa: true },
        ],
      }),
    )
    await marcarNoCalendly(db, args, { cliente: calendly.fabrica })
    const [corpo] = calendly.cliente.criarConvidado.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(corpo.questions_and_answers).toEqual([{ question: 'Contato para a reunião', answer: '+5511999998888', position: 1 }])
  })

  it('sem nome na ficha, o telefone', async () => {
    await marcarNoCalendly(db, { ...args, contactId: 'sem-nome' }, { cliente: calendly.fabrica })
    const [corpo] = calendly.cliente.criarConvidado.mock.calls[0] as unknown as [Record<string, Record<string, unknown>>]
    expect(corpo.invitee.name).toBe('5511888887777')
  })

  it('sem telefone válido: `sem_telefone`, e o Calendly nem é chamado (o webhook não acharia o cliente; Codex, #317)', async () => {
    banco.tabelas.contacts.push({ id: 'sem-telefone', account_id: CONTA, name: 'Ana', phone: null, email: 'ana@x.com' })
    expect(await marcarNoCalendly(db, { ...args, contactId: 'sem-telefone' }, { cliente: calendly.fabrica })).toEqual({
      ok: false,
      erro: 'sem_telefone',
    })
    expect(calendly.cliente.criarConvidado).not.toHaveBeenCalled()
  })

  it('sem e-mail (ficha nem agendamento): `sem_email`, e o Calendly nem é chamado', async () => {
    expect(await marcarNoCalendly(db, { ...args, contactId: 'sem-email' }, { cliente: calendly.fabrica })).toEqual({
      ok: false,
      erro: 'sem_email',
    })
    expect(calendly.cliente.criarConvidado).not.toHaveBeenCalled()
  })

  it('o e-mail do último agendamento serve quando a ficha não tem', async () => {
    banco.tabelas.cb_calendly_eventos = [
      { account_id: CONTA, contact_id: 'sem-email', evento: 'invitee.created', recebido_em: '2026-09-20T00:00:00Z', email: 'ana@x.com', variaveis: {} },
    ]
    expect((await marcarNoCalendly(db, { ...args, contactId: 'sem-email' }, { cliente: calendly.fabrica })).ok).toBe(true)
    const [corpo] = calendly.cliente.criarConvidado.mock.calls[0] as unknown as [Record<string, Record<string, unknown>>]
    expect(corpo.invitee.email).toBe('ana@x.com')
  })

  it('sem Calendly (ou token que não decifra): `calendly_desconectado`', async () => {
    banco.tabelas.cb_calendly_config = []
    expect(await marcarNoCalendly(db, args, { cliente: calendly.fabrica })).toMatchObject({ ok: false, erro: 'calendly_desconectado' })
    banco.tabelas.cb_calendly_config = [{ account_id: CONTA, access_token: 'ilegivel', user_uri: 'u', organization_uri: 'o' }]
    expect(await marcarNoCalendly(db, args, { cliente: calendly.fabrica })).toMatchObject({ ok: false, erro: 'calendly_desconectado' })
    expect(calendly.cliente.criarConvidado).not.toHaveBeenCalled()
  })

  it('erro de banco na conexão: `falhou` (não é "desconectado")', async () => {
    banco.falhas.add('cb_calendly_config')
    expect(await marcarNoCalendly(db, args, { cliente: calendly.fabrica })).toMatchObject({ ok: false, erro: 'falhou' })
  })

  it('tipo de evento desativado depois de liberado: `recusado`, sem POST', async () => {
    calendly.cliente.tipoDeEvento.mockResolvedValueOnce(tipo({ ativo: false }))
    expect(await marcarNoCalendly(db, args, { cliente: calendly.fabrica })).toMatchObject({ ok: false, erro: 'recusado' })
    expect(calendly.cliente.criarConvidado).not.toHaveBeenCalled()
  })

  it.each<[string, unknown, string]>([
    ['409 (horário tomado)', new CalendlyError('calendly_error', '409: Conflict', 409), 'horario_indisponivel'],
    ['400 que fala do horário', new CalendlyError('calendly_error', '400: The selected time is no longer available', 400), 'horario_indisponivel'],
    ['400 de outra coisa', new CalendlyError('calendly_error', '400: invalid email', 400), 'recusado'],
    ['401 (token caiu)', new CalendlyError('token_invalido', '401: Unauthenticated', 401), 'calendly_desconectado'],
    ['rede / tempo', new CalendlyError('rede', 'The operation was aborted due to timeout'), 'falhou'],
    ['erro qualquer', new Error('boom'), 'falhou'],
  ])('a recusa do POST: %s → %s', async (_nome, erro, codigo) => {
    calendly.cliente.criarConvidado.mockRejectedValueOnce(erro)
    const r = await marcarNoCalendly(db, args, { cliente: calendly.fabrica })
    expect(r).toMatchObject({ ok: false, erro: codigo })
    if (!r.ok) expect(r.detalhe).toBeTruthy()
  })

  it('contato de OUTRA conta não é achado: falha, sem POST', async () => {
    expect(await marcarNoCalendly(db, { ...args, accountId: 'outra' }, { cliente: calendly.fabrica })).toMatchObject({
      ok: false,
      erro: 'falhou',
    })
    expect(calendly.cliente.criarConvidado).not.toHaveBeenCalled()
  })
})
