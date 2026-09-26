import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A PORTA da ingestão (`entrada.ts`, docs/PLANO-agentes-de-ia.md 5.3/5.7).
// A regra de QUEM responde é pura e tem teste próprio (`quem-responde.test.ts`);
// aqui se prova o que a porta LÊ e ESCREVE para chegar a ela:
//  - os portões que não precisam do banco não leem nada;
//  - o caso comum ("nenhum agente") custa DUAS leituras curtas e mais nada —
//    é o caminho quente das duas ingestões;
//  - o agente ATIVO só enfileira; a ENTRADA passa antes pela RPC da atribuição
//    (a D17 no banco) e só enfileira quando ela diz `retomada`;
//  - leitura da D16/P8 que falha NÃO vira "nunca teve gente": não atende.
// A fila (`fila.ts`) roda de verdade sobre a RPC falsa; o disparo é dublê.
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
vi.mock('./repo', () => ({ obterAgente: vi.fn() }))
vi.mock('./turno', () => ({ agendarTurno: vi.fn() }))

import { supabaseAdmin } from '@/lib/ai/admin-client'

import type { IaAgente } from './agente'
import { aoChegarMensagemDoCliente, type MensagemDoCliente } from './entrada'
import { ESPERA_DA_RAJADA_MS } from './fila'
import { obterAgente } from './repo'
import { agendarTurno } from './turno'

// ------------------------------------------------------------
// O cenário
// ------------------------------------------------------------

const CONTA = 'conta-1'
const CONVERSA = 'conv-1'
const CANAL = 'canal-1'
const ATIVO = 'ag-ativo'
const ENTRADA = 'ag-entrada'

const haDias = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

function agente(p: Partial<IaAgente> = {}): IaAgente {
  return {
    id: ATIVO,
    accountId: CONTA,
    nome: 'Cobrança',
    descricao: '',
    instrucoes: '',
    regras: [],
    provedor: 'gemini',
    modelo: 'gemini-teste',
    ativo: true,
    conexoes: [CANAL],
    horario: null,
    tetoRespostas: 10,
    podePassarPara: [],
    transferirPara: null,
    arquivadoEm: null,
    createdAt: '',
    updatedAt: '',
    ...p,
  }
}

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

let resultadoDaAtribuicao: Resposta

beforeEach(() => {
  banco = criarBanco()
  banco.tabelas.conversations = [
    {
      id: CONVERSA,
      account_id: CONTA,
      created_at: haDias(0),
      contact_id: 'contato-1',
      group_id: null,
      status: 'open',
      ia_agente_id: null,
      ai_autoreply_disabled: false,
    },
  ]
  banco.tabelas.cb_channels = [
    { id: CANAL, account_id: CONTA, kind: 'evolution', ia_agente_entrada_id: null, ia_agente_entrada_desde: null },
  ]
  // Contato criado HOJE: depois de a entrada ser ligada (P8) nos cenários dela.
  banco.tabelas.contacts = [{ id: 'contato-1', account_id: CONTA, created_at: haDias(0) }]
  banco.tabelas.messages = [
    { id: 'msg-1', conversation_id: CONVERSA, sender_type: 'customer', sender_id: null, from_device: false },
  ]
  banco.rpcs.cb_ia_enfileirar_turno = () => ({
    data: [{ id: 'turno-9', executar_apos: '2026-09-26T12:00:08.000Z' }],
    error: null,
  })
  resultadoDaAtribuicao = { data: [{ resultado: 'retomada', pausada_por: null }], error: null }
  banco.rpcs.cb_atribuir_agente_de_ia = () => resultadoDaAtribuicao

  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.mocked(obterAgente)
    .mockReset()
    .mockImplementation(async (_conta, id) =>
      id === ATIVO ? agente() : id === ENTRADA ? agente({ id: ENTRADA, nome: 'Triagem' }) : null,
    )
  vi.mocked(agendarTurno).mockReset()
  vi.mocked(supabaseAdmin).mockClear()
})

function ligarEntrada(desdeDias = 1): void {
  Object.assign(banco.tabelas.cb_channels[0], { ia_agente_entrada_id: ENTRADA, ia_agente_entrada_desde: haDias(desdeDias) })
}

const nomesDasRpcs = () => banco.rpcChamadas.map((c) => c.nome)
const enfileirou = () => nomesDasRpcs().includes('cb_ia_enfileirar_turno')

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
    // A Meta: o tipo que o webhook não sabe ler (cartão de contato) é gravado
    // como `text` com o rótulo — E9, não abre turno.
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

  it('só o PENDENTE desta conversa e desta conexão, e só dela: rodando, outra conexão e outra conta ficam', async () => {
    banco.tabelas.cb_ia_turnos.push(
      pendente({ id: 't-rodando', status: 'rodando' }),
      pendente({ id: 't-outra-conexao', canal_id: 'canal-2' }),
      pendente({ id: 't-outra-conta', account_id: 'outra-conta' }),
      pendente({ id: 't-outra-conversa', conversation_id: 'conv-2' }),
    )
    await aoChegarMensagemDoCliente(msg({ automacaoFalou: true }))
    const status = Object.fromEntries(banco.tabelas.cb_ia_turnos.map((t) => [t.id, t.status]))
    expect(status).toEqual({
      'turno-pendente': 'descartado',
      't-rodando': 'rodando',
      't-outra-conexao': 'aguardando',
      't-outra-conta': 'aguardando',
      't-outra-conversa': 'aguardando',
    })
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
// O caso comum
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — nenhum agente', () => {
  it('duas leituras (conversa e conexão) e mais nada', async () => {
    await aoChegarMensagemDoCliente(msg())
    expect(banco.chamadas.map((c) => c.tabela).sort()).toEqual(['cb_channels', 'conversations'])
    expect(banco.rpcChamadas).toHaveLength(0)
    expect(obterAgente).not.toHaveBeenCalled()
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it('leitura da conversa ou da conexão que falha: não atende e não lança', async () => {
    banco.falhas.push({ tabela: 'cb_channels', op: 'select', erro: { message: 'timeout' } })
    Object.assign(banco.tabelas.conversations[0], { ia_agente_id: ATIVO })
    await expect(aoChegarMensagemDoCliente(msg())).resolves.toBeUndefined()
    expect(enfileirou()).toBe(false)
  })

  it('conexão de outra conta: não atende', async () => {
    Object.assign(banco.tabelas.conversations[0], { ia_agente_id: ATIVO })
    banco.tabelas.cb_channels[0].account_id = 'outra-conta'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })
})

// ------------------------------------------------------------
// O agente ativo
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — agente ativo', () => {
  beforeEach(() => {
    banco.tabelas.conversations[0].ia_agente_id = ATIVO
  })

  it('enfileira com a espera da rajada, sem a RPC de atribuição, e agenda o disparo', async () => {
    await aoChegarMensagemDoCliente(msg())
    expect(nomesDasRpcs()).toEqual(['cb_ia_enfileirar_turno'])
    expect(banco.rpcChamadas[0].args).toEqual({
      p_account_id: CONTA,
      p_conversation_id: CONVERSA,
      p_canal_id: CANAL,
      p_ia_agente_id: ATIVO,
      p_mensagem_id: 'msg-1',
      p_espera_ms: ESPERA_DA_RAJADA_MS,
    })
    expect(agendarTurno).toHaveBeenCalledWith({ id: 'turno-9', executarApos: '2026-09-26T12:00:08.000Z' })
    // A D16/P8 é só da entrada: nada de ler mensagens nem contato.
    expect(banco.chamadas.some((c) => c.tabela === 'messages' || c.tabela === 'contacts')).toBe(false)
  })

  it.each(['audio', 'image', 'document', 'video'])('%s também abre turno (sem texto)', async (tipo) => {
    await aoChegarMensagemDoCliente(msg({ tipo, texto: null }))
    expect(enfileirou()).toBe(true)
  })

  it('foto (image sem o MIME da figurinha) abre turno', async () => {
    await aoChegarMensagemDoCliente(msg({ tipo: 'image', texto: null, mime: 'image/jpeg' }))
    expect(enfileirou()).toBe(true)
  })

  it('conversa pausada: não enfileira', async () => {
    banco.tabelas.conversations[0].ai_autoreply_disabled = true
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('conversa ENCERRADA (uma automação a fechou sem falar): não enfileira', async () => {
    banco.tabelas.conversations[0].status = 'closed'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
    expect(obterAgente).not.toHaveBeenCalled()
  })

  it('conversa de grupo (lida do banco): não enfileira', async () => {
    banco.tabelas.conversations[0].group_id = 'grupo-1'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('conexão do Instagram: não enfileira', async () => {
    banco.tabelas.cb_channels[0].kind = 'instagram'
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('agente ativo DESLIGADO com entrada na conexão: ninguém — a entrada não o substitui', async () => {
    ligarEntrada()
    vi.mocked(obterAgente).mockImplementation(async (_c, id) =>
      id === ATIVO ? agente({ ativo: false }) : id === ENTRADA ? agente({ id: ENTRADA }) : null,
    )
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it('o agente ativo não cobre a conexão da mensagem: ninguém', async () => {
    vi.mocked(obterAgente).mockResolvedValue(agente({ conexoes: ['canal-2'] }))
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('a fila recusa (erro da RPC): não agenda nada', async () => {
    banco.rpcs.cb_ia_enfileirar_turno = () => ({ data: null, error: { message: 'falhou' } })
    await aoChegarMensagemDoCliente(msg())
    expect(agendarTurno).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// O agente de entrada
// ------------------------------------------------------------

describe('aoChegarMensagemDoCliente — agente de entrada', () => {
  beforeEach(() => ligarEntrada())

  it('atribui pela RPC (com a conexão) e enfileira quando ela diz `retomada`', async () => {
    await aoChegarMensagemDoCliente(msg())
    expect(nomesDasRpcs()).toEqual(['cb_atribuir_agente_de_ia', 'cb_ia_enfileirar_turno'])
    expect(banco.rpcChamadas[0].args).toEqual(
      expect.objectContaining({
        p_account_id: CONTA,
        p_conversation_id: CONVERSA,
        p_ia_agente_id: ENTRADA,
        // A RPC relê o agente na transação e confere que ele ATENDE esta
        // conexão: editado no meio, a conversa ficaria com um agente que não
        // responde aqui (regra 4) e a entrada não o substitui (regra 5).
        p_canal_id: CANAL,
        // Só se a conversa ainda não tem agente (ver o teste da corrida).
        p_so_se_vazio: true,
      }),
    )
    expect(banco.rpcChamadas[1].args).toEqual(expect.objectContaining({ p_ia_agente_id: ENTRADA }))
    expect(agendarTurno).toHaveBeenCalledTimes(1)
  })

  // A leitura da conversa é uma foto: entre ela e a atribuição, a régua do
  // Asaas (ou um "Atribuir agente" de automação) pode pôr um ESPECIALISTA. A
  // entrada não passa por cima dele. O dublê imita a RPC da 1044 com o
  // contrato do `p_so_se_vazio`: com a conversa já tendo agente, devolve
  // `ocupada` e não escreve nada; sem o parâmetro, sobrescreve (é o
  // comportamento do passo da automação, que continua valendo para ela).
  it('outra frente atribuiu um especialista entre a leitura e a atribuição: `ocupada`, o especialista fica e nada é enfileirado', async () => {
    const ESPECIALISTA = 'ag-especialista'
    banco.rpcs.cb_atribuir_agente_de_ia = ({ p_conversation_id, p_ia_agente_id, p_so_se_vazio }) => {
      const c = banco.tabelas.conversations.find((x) => x.id === p_conversation_id)!
      // A corrida: a régua atribuiu o especialista um instante antes.
      c.ia_agente_id = ESPECIALISTA
      if (p_so_se_vazio === true && c.ia_agente_id !== null) {
        return { data: [{ resultado: 'ocupada', pausada_por: null }], error: null }
      }
      c.ia_agente_id = p_ia_agente_id
      return { data: [{ resultado: 'retomada', pausada_por: null }], error: null }
    }
    await aoChegarMensagemDoCliente(msg())
    expect(banco.tabelas.conversations[0].ia_agente_id).toBe(ESPECIALISTA)
    expect(nomesDasRpcs()).toEqual(['cb_atribuir_agente_de_ia'])
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it.each(['ocupada', 'pausada_gente', 'pausada_mantida', 'agente_indisponivel', 'sem_conversa'])(
    'a atribuição devolve `%s`: não enfileira',
    async (resultado) => {
      resultadoDaAtribuicao = { data: [{ resultado, pausada_por: null }], error: null }
      await aoChegarMensagemDoCliente(msg())
      expect(nomesDasRpcs()).toEqual(['cb_atribuir_agente_de_ia'])
      expect(agendarTurno).not.toHaveBeenCalled()
    },
  )

  it('erro na atribuição: não enfileira', async () => {
    resultadoDaAtribuicao = { data: null, error: { message: 'lock timeout' } }
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(false)
  })

  it('D16: a conversa já teve resposta de gente pelo celular → não atende', async () => {
    banco.tabelas.messages.push({
      id: 'msg-0',
      conversation_id: CONVERSA,
      sender_type: 'agent',
      sender_id: null,
      from_device: true,
    })
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('D16: resposta de gente pelo CRM (sender_id) → não atende', async () => {
    banco.tabelas.messages.push({
      id: 'msg-0',
      conversation_id: CONVERSA,
      sender_type: 'agent',
      sender_id: 'advogado-1',
      from_device: false,
    })
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('D16: mensagem do robô ou de disparo não conta como gente', async () => {
    banco.tabelas.messages.push({
      id: 'msg-0',
      conversation_id: CONVERSA,
      sender_type: 'bot',
      sender_id: null,
      from_device: false,
    })
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(true)
  })

  it('P8: contato criado ANTES de a entrada ser ligada → não atende', async () => {
    banco.tabelas.contacts[0].created_at = haDias(30)
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('P8: contato importado (nasceu 3 dias antes da conversa) → não atende (Codex, #292)', async () => {
    ligarEntrada(10)
    banco.tabelas.contacts[0].created_at = haDias(3)
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
    // Controle: nascido junto com a conversa, a entrada atende.
    banco.tabelas.contacts[0].created_at = banco.tabelas.conversations[0].created_at
    await aoChegarMensagemDoCliente(msg())
    expect(enfileirou()).toBe(true)
  })

  it('P8: conversa sem contato → não atende (sem a data, o lado que atende menos)', async () => {
    banco.tabelas.conversations[0].contact_id = null
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it.each(['messages', 'contacts'])('leitura de %s que FALHA não vira "nunca teve gente": não atende', async (tabela) => {
    banco.falhas.push({ tabela, op: 'select', erro: { message: 'timeout' } })
    await expect(aoChegarMensagemDoCliente(msg())).resolves.toBeUndefined()
    expect(banco.rpcChamadas).toHaveLength(0)
    expect(agendarTurno).not.toHaveBeenCalled()
  })

  it('entrada desligada ou arquivada: não atende', async () => {
    vi.mocked(obterAgente).mockResolvedValue(agente({ id: ENTRADA, ativo: false }))
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('a entrada não cobre a conexão: não atende', async () => {
    vi.mocked(obterAgente).mockResolvedValue(agente({ id: ENTRADA, conexoes: ['canal-2'] }))
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('conversa pausada: não atende (nem pergunta à D16)', async () => {
    banco.tabelas.conversations[0].ai_autoreply_disabled = true
    await aoChegarMensagemDoCliente(msg())
    expect(banco.rpcChamadas).toHaveLength(0)
  })

  it('o cliente do banco lança: não atende e não lança', async () => {
    vi.mocked(supabaseAdmin).mockImplementationOnce(() => {
      throw new Error('sem SUPABASE_SERVICE_ROLE_KEY')
    })
    await expect(aoChegarMensagemDoCliente(msg())).resolves.toBeUndefined()
    expect(agendarTurno).not.toHaveBeenCalled()
  })
})
