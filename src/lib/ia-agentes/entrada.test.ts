import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A PORTA da ingestão (`entrada.ts`, docs/PLANO-agentes-de-ia.md D24–D27).
// A regra de QUEM responde é pura e tem teste próprio (`quem-responde.test.ts`);
// aqui se prova o que a porta LÊ e ESCREVE para chegar a ela:
//  - os portões que não precisam do banco não leem nada;
//  - o robô ou uma automação que respondeu descarta o pendente, sem leitura;
//  - o agente da ETAPA do card aberto enfileira o turno com o agente, o card
//    e a etapa; sem card, etapa sem agente, card antigo (D27), agente de outra
//    conexão, pausada: não enfileira;
//  - leitura que falha não lança e não atende.
// A fila (`fila.ts`) e a leitura (`lerQuemAtende`) rodam de verdade sobre o
// banco falso; o disparo é dublê.
// ============================================================

// ------------------------------------------------------------
// O banco falso: imita do PostgREST só o que o motor usa (os filtros,
// `update/insert … select`, `maybeSingle`, as RPCs). Cada chamada da cadeia
// vira um passo; o `await` (ou `maybeSingle`) executa sobre as tabelas.
// ------------------------------------------------------------

type Linha = Record<string, unknown>
type Erro = { message: string; code?: string }
type Resposta = { data: unknown; error: Erro | null }

interface Banco {
  tabelas: Record<string, Linha[]>
  rpcs: Record<string, (args: Record<string, unknown>) => Resposta>
  chamadas: Array<{ tabela: string; op: string; valores: unknown }>
  rpcChamadas: Array<{ nome: string; args: Record<string, unknown> }>
  /** Falha a PRÓXIMA operação que casar (uma vez só). */
  falhas: Array<{ tabela: string; op: string; erro: Erro }>
  /** Roda antes de cada operação (a corrida com outro processo). */
  antes: ((tabela: string, op: string) => void) | null
  from(tabela: string): unknown
  rpc(nome: string, args: Record<string, unknown>): Promise<Resposta>
}

const DATA_ISO = /^\d{4}-\d\d-\d\dT/
const temValor = (v: unknown) => v !== null && v !== undefined

function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    if (DATA_ISO.test(a) && DATA_ISO.test(b)) return Date.parse(a) - Date.parse(b)
    return a < b ? -1 : a > b ? 1 : 0
  }
  return Number(a) - Number(b)
}

/** `col.is.null` / `col.not.is.null` / `col.eq.x` — o que o motor manda em `.or()`. */
function itemDoOr(item: string): (l: Linha) => boolean {
  const partes = item.split('.')
  const nega = partes[1] === 'not'
  const bruto = partes.slice(nega ? 3 : 2).join('.')
  const valor = bruto === 'null' ? null : bruto === 'true' ? true : bruto === 'false' ? false : bruto
  const casa = (l: Linha) => (l[partes[0]] ?? null) === valor
  return (l) => casa(l) !== nega
}

function filtro(metodo: string, args: unknown[]): ((l: Linha) => boolean) | null {
  const [c, v] = args as [string, unknown]
  switch (metodo) {
    case 'eq': return (l) => temValor(l[c]) && l[c] === v
    case 'neq': return (l) => temValor(l[c]) && l[c] !== v
    case 'is': return (l) => (l[c] ?? null) === v
    case 'in': return (l) => (v as unknown[]).includes(l[c])
    case 'gt': return (l) => temValor(l[c]) && comparar(l[c], v) > 0
    case 'gte': return (l) => temValor(l[c]) && comparar(l[c], v) >= 0
    case 'lt': return (l) => temValor(l[c]) && comparar(l[c], v) < 0
    case 'lte': return (l) => temValor(l[c]) && comparar(l[c], v) <= 0
    case 'or': {
      const itens = c.split(',').map(itemDoOr)
      return (l) => itens.some((f) => f(l))
    }
    default: return null
  }
}

function criarBanco(): Banco {
  let seq = 0
  const banco: Banco = {
    tabelas: {},
    rpcs: {},
    chamadas: [],
    rpcChamadas: [],
    falhas: [],
    antes: null,
    from(tabela) {
      const passos: Array<[string, unknown[]]> = []
      const executar = async (): Promise<Resposta> => {
        const op = passos.find(([m]) => m === 'update' || m === 'insert')?.[0] ?? 'select'
        const valores = passos.find(([m]) => m === op)?.[1][0]
        const devolver = op !== 'select' && passos.some(([m]) => m === 'select')
        banco.antes?.(tabela, op)
        banco.chamadas.push({ tabela, op, valores })
        const i = banco.falhas.findIndex((f) => f.tabela === tabela && f.op === op)
        if (i >= 0) return { data: null, error: banco.falhas.splice(i, 1)[0].erro }
        const linhas = (banco.tabelas[tabela] ??= [])
        if (op === 'insert') {
          const novas = [valores].flat().map((v) => ({ id: `${tabela}-${++seq}`, ...(v as Linha) }))
          linhas.push(...novas)
          return { data: devolver ? novas.map((n) => ({ ...n })) : null, error: null }
        }
        const predicados = passos.map(([m, a]) => filtro(m, a)).filter((p) => p !== null)
        let alvo = linhas.filter((l) => predicados.every((p) => p(l)))
        if (op === 'update') {
          for (const l of alvo) Object.assign(l, valores)
          return { data: devolver ? alvo.map((l) => ({ ...l })) : null, error: null }
        }
        const ordem = passos.find(([m]) => m === 'order')?.[1] as [string, { ascending?: boolean }?] | undefined
        if (ordem) {
          const sinal = ordem[1]?.ascending === false ? -1 : 1
          alvo = [...alvo].sort((a, b) => sinal * comparar(a[ordem[0]], b[ordem[0]]))
        }
        const limite = passos.find(([m]) => m === 'limit')?.[1][0] as number | undefined
        if (limite !== undefined) alvo = alvo.slice(0, limite)
        return { data: alvo.map((l) => ({ ...l })), error: null }
      }
      const cadeia: object = new Proxy(
        {},
        {
          get(_alvo, prop) {
            if (typeof prop === 'symbol') return undefined
            if (prop === 'then') {
              return (ok: (r: Resposta) => unknown, erro: (e: unknown) => unknown) => executar().then(ok, erro)
            }
            if (prop === 'maybeSingle' || prop === 'single') {
              return async () => {
                const r = await executar()
                return r.error ? r : { data: (r.data as Linha[] | null)?.[0] ?? null, error: null }
              }
            }
            return (...args: unknown[]) => {
              passos.push([prop, args])
              return cadeia
            }
          },
        },
      )
      return cadeia
    },
    async rpc(nome, args) {
      banco.rpcChamadas.push({ nome, args })
      const f = banco.rpcs[nome]
      return f ? f(args) : { data: null, error: { message: `rpc ${nome} desconhecida` } }
    },
  }
  return banco
}

// ------------------------------------------------------------
// Os dublês
// ------------------------------------------------------------

let banco = criarBanco()

vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: vi.fn(() => banco) }))
vi.mock('./turno', () => ({ agendarTurno: vi.fn() }))

import { supabaseAdmin } from '@/lib/ai/admin-client'

import { aoChegarMensagemDoCliente, type MensagemDoCliente } from './entrada'
import { ESPERA_DA_RAJADA_MS } from './fila'
import { agendarTurno } from './turno'

// ------------------------------------------------------------
// O cenário: o card do contato na etapa do agente, que entrou nela DEPOIS de
// o agente ser ligado (D27)
// ------------------------------------------------------------

const CONTA = 'conta-1'
const CONVERSA = 'conv-1'
const CANAL = 'canal-1'
const AGENTE = 'ag-cobranca'
const ETAPA = 'etapa-cobranca'
const FUNIL = 'funil-1'
const CARD = 'deal-1'

const haDias = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const haMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

function msg(p: Partial<MensagemDoCliente> = {}): MensagemDoCliente {
  return {
    accountId: CONTA,
    conversationId: CONVERSA,
    canalGravado: CANAL,
    mensagemId: 'msg-1',
    tipo: 'text',
    texto: 'Oi, preciso de ajuda',
    mime: null,
    ehGrupo: false,
    ehRespostaDeBotao: false,
    roboConsumiu: false,
    automacaoFalou: false,
    ...p,
  }
}

function card(p: Linha = {}): Linha {
  return {
    id: CARD,
    account_id: CONTA,
    contact_id: 'contato-1',
    status: 'open',
    pipeline_id: FUNIL,
    stage_id: ETAPA,
    etapa_desde: haMin(5),
    created_at: haDias(3),
    ...p,
  }
}

beforeEach(() => {
  banco = criarBanco()
  banco.tabelas.conversations = [
    {
      id: CONVERSA,
      account_id: CONTA,
      contact_id: 'contato-1',
      group_id: null,
      status: 'open',
      ai_autoreply_disabled: false,
    },
  ]
  banco.tabelas.cb_channels = [{ id: CANAL, account_id: CONTA, kind: 'evolution' }]
  banco.tabelas.deals = [card()]
  banco.tabelas.cb_ia_agente_etapas = [{ stage_id: ETAPA, account_id: CONTA, ia_agente_id: AGENTE, desde: haDias(1) }]
  banco.tabelas.cb_ia_agentes = [
    { id: AGENTE, account_id: CONTA, ativo: true, arquivado_em: null, conexoes: [CANAL], ativado_em: haDias(2) },
  ]
  banco.rpcs.cb_ia_enfileirar_turno = () => ({
    data: [{ id: 'turno-9', executar_apos: '2026-09-26T12:00:08.000Z' }],
    error: null,
  })

  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(agendarTurno).mockReset()
  vi.mocked(supabaseAdmin).mockClear()
})

const nomesDasRpcs = () => banco.rpcChamadas.map((c) => c.nome)
const enfileirou = () => nomesDasRpcs().includes('cb_ia_enfileirar_turno')
const tabelasLidas = () => banco.chamadas.map((c) => c.tabela)

// ------------------------------------------------------------
// Os portões sem banco
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — portões que não leem o banco', () => {
  it.each<[string, Partial<MensagemDoCliente>]>([
    ['grupo', { ehGrupo: true }],
    ['sem conexão gravada', { canalGravado: null }],
    ['toque em botão de modelo (sem automação falando)', { ehRespostaDeBotao: true }],
    // As formas GRAVADAS: as duas ingestões gravam a figurinha como `image`
    // (com `image/webp`), e a Evolution entrega cartão de contato, enquete e
    // resposta de botão como `text` sem texto.
    ['figurinha', { tipo: 'image', texto: null, mime: 'image/webp' }],
    ['texto nulo (cartão de contato, enquete, botão)', { tipo: 'text', texto: null }],
    ['texto sem nada visível', { tipo: 'text', texto: ' \uFFFC\n' }],
    ['cartão de contato pela Meta (tipo não suportado)', { tipo: 'text', texto: '[Unsupported message type: contacts]' }],
    ['localização', { tipo: 'location' }],
  ])('%s: nem abre o cliente do banco', async (_rotulo, p) => {
    await aoChegarMensagemDoCliente(msg(p))
    expect(supabaseAdmin).not.toHaveBeenCalled()
    expect(banco.chamadas).toHaveLength(0)
    expect(agendarTurno).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// O robô ou uma automação respondeu: o PENDENTE da conexão sai (Codex, #292)
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — o robô ou uma automação respondeu', () => {
  function pendente(p: Linha = {}): Linha {
    return {
      id: 'turno-pendente',
      account_id: CONTA,
      conversation_id: CONVERSA,
      canal_id: CANAL,
      status: 'aguardando',
      erro: null,
      terminado_em: null,
      ...p,
    }
  }
  const turnoPendente = () => banco.tabelas.cb_ia_turnos.find((t) => t.id === 'turno-pendente')!

  beforeEach(() => {
    banco.tabelas.cb_ia_turnos = [pendente()]
  })

  it.each<[string, Partial<MensagemDoCliente>]>([
    ['automação de botão respondeu (o toque durante a rajada)', { tipo: 'interactive', ehRespostaDeBotao: true, automacaoFalou: true }],
    ['uma automação falou (E4)', { automacaoFalou: true }],
    ['o robô consumiu', { roboConsumiu: true }],
  ])('%s: descarta o pendente desta conexão, numa escrita só, sem leitura e sem enfileirar', async (_rotulo, p) => {
    await aoChegarMensagemDoCliente(msg(p))
    expect(turnoPendente()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(turnoPendente().terminado_em).toEqual(expect.any(String))
    expect(banco.chamadas).toEqual([expect.objectContaining({ tabela: 'cb_ia_turnos', op: 'update' })])
    expect(enfileirou()).toBe(false)
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it('só desta conversa e desta conexão, e só dela: outra conexão, outra conta e outra conversa ficam', async () => {
    banco.tabelas.cb_ia_turnos.push(
      pendente({ id: 't-outra-conexao', canal_id: 'canal-2' }),
      pendente({ id: 't-outra-conta', account_id: 'outra-conta' }),
      pendente({ id: 't-outra-conversa', conversation_id: 'conv-2' }),
      pendente({ id: 't-rodando-outra-conexao', canal_id: 'canal-2', status: 'rodando' }),
    )
    await aoChegarMensagemDoCliente(msg({ automacaoFalou: true }))
    const status = Object.fromEntries(banco.tabelas.cb_ia_turnos.map((t) => [t.id, t.status]))
    expect(status).toEqual({
      'turno-pendente': 'descartado',
      't-outra-conexao': 'aguardando',
      't-outra-conta': 'aguardando',
      't-outra-conversa': 'aguardando',
      't-rodando-outra-conexao': 'rodando',
    })
  })

  // O turno que RODA também sai (Codex, #292): o toque que leva o fluxo direto
  // a um nó de fim não gera saída do robô, e a conferência do turno (que
  // procura essa saída) deixaria a resposta velha sair depois de o fluxo
  // tomar a conversa. A reserva do envio exige o turno ainda `rodando`.
  it.each<[string, Partial<MensagemDoCliente>]>([
    ['o robô consumiu', { roboConsumiu: true }],
    ['uma automação falou', { automacaoFalou: true }],
  ])('%s: o turno que RODA nesta conexão (sem ter reservado) também é descartado, com o motivo e a hora', async (_rotulo, p) => {
    banco.tabelas.cb_ia_turnos = [pendente({ id: 't-rodando', status: 'rodando', rodando_desde: '2026-09-26T12:00:00.000Z', enviando_desde: null })]
    await aoChegarMensagemDoCliente(msg(p))
    const rodando = banco.tabelas.cb_ia_turnos[0]
    expect(rodando).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(rodando.terminado_em).toEqual(expect.any(String))
    expect(banco.chamadas).toEqual([expect.objectContaining({ tabela: 'cb_ia_turnos', op: 'update' })])
  })

  // O turno carimba `enviando_desde` DEPOIS da reserva: com ele, o envio já
  // está autorizado e em voo. Marcá-lo mentiria no registro (e calaria a
  // transferência do `incerto`) sem impedir nada.
  it('o turno que JÁ reservou o envio (`enviando_desde`) não é tocado', async () => {
    banco.tabelas.cb_ia_turnos = [
      pendente({ id: 't-enviando', status: 'rodando', rodando_desde: '2026-09-26T12:00:00.000Z', enviando_desde: '2026-09-26T12:00:09.000Z' }),
    ]
    await aoChegarMensagemDoCliente(msg({ automacaoFalou: true }))
    expect(banco.tabelas.cb_ia_turnos[0]).toMatchObject({ status: 'rodando', erro: null, terminado_em: null })
  })

  it.each<[string, Partial<MensagemDoCliente>]>([
    ['figurinha sem automação falando', { tipo: 'image', texto: null, mime: 'image/webp' }],
    ['toque em botão sem automação falando', { tipo: 'interactive', ehRespostaDeBotao: true }],
    ['localização', { tipo: 'location' }],
  ])('%s: NÃO cancela nada', async (_rotulo, p) => {
    await aoChegarMensagemDoCliente(msg(p))
    expect(turnoPendente().status).toBe('aguardando')
    expect(banco.chamadas).toHaveLength(0)
  })

  it('grupo ou sem conexão gravada: não toca em nada', async () => {
    await aoChegarMensagemDoCliente(msg({ automacaoFalou: true, ehGrupo: true }))
    await aoChegarMensagemDoCliente(msg({ automacaoFalou: true, canalGravado: null }))
    expect(turnoPendente().status).toBe('aguardando')
    expect(banco.chamadas).toHaveLength(0)
  })

  it('a escrita que falha não lança', async () => {
    banco.falhas.push({ tabela: 'cb_ia_turnos', op: 'update', erro: { message: 'timeout' } })
    await expect(aoChegarMensagemDoCliente(msg({ automacaoFalou: true }))).resolves.toBeUndefined()
    expect(turnoPendente().status).toBe('aguardando')
  })
})

// ------------------------------------------------------------
// O agente da ETAPA (D24)
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — o agente da etapa do card', () => {
  it('card na etapa do agente: enfileira com o agente, o CARD e a ETAPA, com a espera da rajada, e agenda o disparo', async () => {
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toEqual([
      {
        nome: 'cb_ia_enfileirar_turno',
        args: {
          p_account_id: CONTA,
          p_conversation_id: CONVERSA,
          p_canal_id: CANAL,
          p_ia_agente_id: AGENTE,
          p_mensagem_id: 'msg-1',
          p_deal_id: CARD,
          p_stage_id: ETAPA,
          p_veio_de_passagem: false,
          p_espera_ms: ESPERA_DA_RAJADA_MS,
        },
      },
    ])
    expect(agendarTurno).toHaveBeenCalledWith({ id: 'turno-9', executarApos: '2026-09-26T12:00:08.000Z' })
  })

  it('foto, áudio e documento abrem turno', async () => {
    for (const p of [
      { tipo: 'image', texto: null, mime: 'image/jpeg' },
      { tipo: 'audio', texto: null, mime: 'audio/ogg' },
      { tipo: 'document', texto: null, mime: 'application/pdf' },
    ]) {
      await aoChegarMensagemDoCliente(msg(p))
    }
    expect(agendarTurno).toHaveBeenCalledTimes(3)
  })

  it('D27: card ANTIGO (parado na etapa desde antes de o agente ser ligado nela) não é atendido', async () => {
    banco.tabelas.deals = [card({ etapa_desde: haDias(30) })]
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it('D27: o agente foi religado DEPOIS de o card entrar na etapa: não atende', async () => {
    banco.tabelas.cb_ia_agentes[0].ativado_em = haMin(1)
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('sem card aberto: não enfileira, e para depois do card (sem ler etapa nem agente)', async () => {
    banco.tabelas.deals = []
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
    expect(tabelasLidas()).toEqual(['conversations', 'cb_channels', 'deals'])
  })

  it('card GANHO ou PERDIDO na etapa do agente não conta (só o aberto)', async () => {
    banco.tabelas.deals = [card({ status: 'won' }), card({ id: 'deal-2', status: 'lost' })]
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('o card ABERTO MAIS RECENTE decide: o antigo na etapa do agente não conta', async () => {
    banco.tabelas.deals = [card({ created_at: haDias(10) }), card({ id: 'deal-2', stage_id: 'etapa-sem-agente', created_at: haDias(1) })]
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('card de OUTRO contato na etapa do agente não conta', async () => {
    banco.tabelas.deals = [card({ contact_id: 'contato-2' })]
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('etapa sem agente: não enfileira (e não lê agente nenhum)', async () => {
    banco.tabelas.cb_ia_agente_etapas = []
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
    expect(tabelasLidas()).not.toContain('cb_ia_agentes')
  })

  it('agente de OUTRA conexão: não enfileira', async () => {
    banco.tabelas.cb_ia_agentes[0].conexoes = ['canal-2']
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('agente desligado ou arquivado: não enfileira', async () => {
    banco.tabelas.cb_ia_agentes[0].ativo = false
    await aoChegarMensagemDoCliente(msg())
    banco.tabelas.cb_ia_agentes[0].ativo = true
    banco.tabelas.cb_ia_agentes[0].arquivado_em = haDias(0)
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('agente de OUTRA conta na linha da etapa: não é lido, não enfileira', async () => {
    banco.tabelas.cb_ia_agentes[0].account_id = 'outra-conta'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it.each<[string, Linha]>([
    ['pausada (gente respondeu, o botão, a transferência)', { ai_autoreply_disabled: true }],
    ['ENCERRADA (uma automação a fechou sem falar)', { status: 'closed' }],
    ['de grupo (lida do banco)', { group_id: 'grupo-1' }],
    ['sem contato', { contact_id: null }],
  ])('conversa %s: não enfileira, e nem lê o card', async (_rotulo, p) => {
    Object.assign(banco.tabelas.conversations[0], p)
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
    expect(tabelasLidas()).not.toContain('deals')
  })

  it('conexão do Instagram: não enfileira', async () => {
    banco.tabelas.cb_channels[0].kind = 'instagram'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('conversa de outra conta: não enfileira', async () => {
    banco.tabelas.conversations[0].account_id = 'outra-conta'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it.each(['conversations', 'deals', 'cb_ia_agente_etapas', 'cb_ia_agentes'])(
    'leitura de %s que falha: não atende e não lança',
    async (tabela) => {
      banco.falhas.push({ tabela, op: 'select', erro: { message: 'timeout' } })
      await expect(aoChegarMensagemDoCliente(msg())).resolves.toBeUndefined()
      expect(enfileirou()).toBe(false)
    },
  )

  it('a fila recusa (erro da RPC): não agenda nada', async () => {
    banco.rpcs.cb_ia_enfileirar_turno = () => ({ data: null, error: { message: 'lock timeout' } })
    await aoChegarMensagemDoCliente(msg())
    expect(agendarTurno).not.toHaveBeenCalled()
  })
})
