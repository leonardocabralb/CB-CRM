import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O TURNO do agente de IA (`turno.ts`, docs/PLANO-agentes-de-ia.md D24–D27 e
// E5–E10). O banco é FALSO, em memória, e imita do PostgREST só o que o turno
// usa (filtros, `update … select`, `maybeSingle`, as RPCs da 1049). Provedor
// de IA, envio, transcrição, chave e o dreno do funil são dublês; o resto
// (a leitura de quem atende, contexto, pedido, horário, textos da
// transferência, `donoDaConta`) roda de verdade.
//
// ⚠️ O que estes testes seguram, e por quê:
//  - o turno responde SÓ enquanto o card continua na etapa com que nasceu e
//    o agente continua dono dela (D24/D27);
//  - a PASSAGEM (D25): o card vai para a etapa do agente escolhido e um turno
//    novo dele responde à MESMA mensagem; passagem de passagem, agente
//    inválido e card que já saiu da etapa transferem para gente;
//  - NUNCA reenviar: o que falha no meio do envio vira `incerto` e vai para
//    gente; só a recusa COMPROVADA (4xx) ou o erro antes do provedor é
//    `falhou`;
//  - falha de CONFIGURAÇÃO não transfere (E8);
//  - a cerca de posse: turno recolhido por outro processo não envia.
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

vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => banco }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ logAiUsage: vi.fn(async () => {}) }))
// `concluirDigitando` é o de verdade (a espera de no máximo 2 s e o cancelamento).
vi.mock('@/lib/ai/digitando', async (original) => ({
  ...(await original<typeof import('@/lib/ai/digitando')>()),
  mostrarDigitando: vi.fn(async () => 'pulado'),
}))
vi.mock('@/lib/automations/drain-events', () => ({ drenarEventosDeFunil: vi.fn(async () => ({})) }))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(),
  // A base do agente (F3) sem chave da OpenAI: só a busca por palavras.
  lerChaveDeEmbeddings: vi.fn(async () => ({ chave: null, ilegivel: false, recusada: false })),
}))
vi.mock('@/lib/transcricao/transcrever', () => ({ transcreverAudio: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(() => ({ success: true })),
  RATE_LIMITS: { aiAutoReplyAccount: { limit: 30, windowMs: 60_000 } },
}))
vi.mock('./repo', () => ({ obterAgente: vi.fn() }))
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: vi.fn(),
}))
vi.mock('@/lib/flows/meta-send', async (original) => ({
  ...(await original<typeof import('@/lib/flows/meta-send')>()),
  engineSendText: vi.fn(),
}))

import { after } from 'next/server'

import { generateReply } from '@/lib/ai/generate'
import { AiError } from '@/lib/ai/types'
import { logAiUsage } from '@/lib/ai/usage'
import { mostrarDigitando } from '@/lib/ai/digitando'
import { drenarEventosDeFunil } from '@/lib/automations/drain-events'
import {
  CanalExigidoIndisponivelError,
  EnviadaSemRegistroError,
  engineSendText,
} from '@/lib/flows/meta-send'
import { lerChave } from '@/lib/ia-chaves/repo'
import { checkRateLimit } from '@/lib/rate-limit'
import { transcreverAudio } from '@/lib/transcricao/transcrever'
import { EvolutionApiError } from '@/lib/whatsapp/transport/evolution-client'
import { MetaApiError } from '@/lib/whatsapp/meta-api'

import { lerLinhaDoAgente } from './agente'
import { JANELA_DO_AUDIO_MS } from './fila'
import { obterAgente } from './repo'
import { executarTurno, nadaSaiu, transferirParaGente } from './turno'

// ------------------------------------------------------------
// O cenário: o card do contato na etapa da TRIAGEM, que entrou nela depois de
// a triagem ser ligada (D27)
// ------------------------------------------------------------

const CONTA = 'conta-1'
const CONVERSA = 'conv-1'
const CANAL = 'canal-1'
const OUTRO_CANAL = 'canal-2'
const AGENTE = 'ag-1'
const DESTINO = 'ag-2'
const MEMBRO = 'membro-1'
const TURNO = 'turno-1'
const GATILHO = 'msg-1'
const CARD = 'deal-1'
const FUNIL = 'funil-1'
const ETAPA = 'etapa-triagem'
const ETAPA_DESTINO = 'etapa-cobranca'
const DIA = 86_400_000

const haMs = (ms: number) => new Date(Date.now() - ms).toISOString()
const daquiMs = (ms: number) => new Date(Date.now() + ms).toISOString()

/** A linha de `cb_ia_agentes` (o `obterAgente` falso a lê pela função de verdade). */
function linhaDoAgente(p: Linha = {}): Linha {
  return {
    id: AGENTE,
    account_id: CONTA,
    nome: 'Triagem',
    descricao: '',
    instrucoes: 'Seja breve.',
    regras: [],
    provedor: 'gemini',
    modelo: 'gemini-teste',
    ativo: true,
    conexoes: [CANAL],
    horario: null,
    teto_respostas: 10,
    pode_passar_para: [],
    transferir_para: MEMBRO,
    ativado_em: haMs(2 * DIA),
    arquivado_em: null,
    ...p,
  }
}

function mensagem(p: Linha = {}): Linha {
  return {
    id: GATILHO,
    conversation_id: CONVERSA,
    channel_id: CANAL,
    sender_type: 'customer',
    sender_id: null,
    from_device: false,
    content_type: 'text',
    content_text: 'Oi, preciso de ajuda',
    media_type: null,
    message_id: 'wamid.cliente',
    ia_agente_id: null,
    gravada_em: haMs(20_000),
    created_at: haMs(20_000),
    deleted_at: null,
    edited_at: null,
    transcricao: null,
    transcricao_status: null,
    media_filename: null,
    ...p,
  }
}

function montarCenario(): void {
  banco = criarBanco()
  banco.tabelas.accounts = [{ id: CONTA, owner_user_id: 'dono-1' }]
  banco.tabelas.conversations = [
    {
      id: CONVERSA,
      account_id: CONTA,
      contact_id: 'contato-1',
      group_id: null,
      status: 'open',
      ia_agente_id: null,
      ai_autoreply_disabled: false,
      assigned_agent_id: null,
      ia_pausada_por: null,
      ia_pausada_em: null,
      ia_retomada_em: null,
    },
  ]
  banco.tabelas.cb_channels = [
    { id: CANAL, account_id: CONTA, kind: 'evolution' },
    { id: OUTRO_CANAL, account_id: CONTA, kind: 'evolution' },
  ]
  banco.tabelas.deals = [
    {
      id: CARD,
      account_id: CONTA,
      contact_id: 'contato-1',
      status: 'open',
      pipeline_id: FUNIL,
      stage_id: ETAPA,
      etapa_desde: haMs(60_000),
      created_at: haMs(DIA),
    },
  ]
  banco.tabelas.pipelines = [{ id: FUNIL, created_at: haMs(100 * DIA) }]
  banco.tabelas.pipeline_stages = [
    { id: ETAPA, pipeline_id: FUNIL, position: 0 },
    { id: 'etapa-meio', pipeline_id: FUNIL, position: 1 },
    { id: ETAPA_DESTINO, pipeline_id: FUNIL, position: 2 },
  ]
  banco.tabelas.cb_ia_agente_etapas = [{ stage_id: ETAPA, account_id: CONTA, ia_agente_id: AGENTE, desde: haMs(DIA) }]
  banco.tabelas.cb_ia_agentes = [linhaDoAgente()]
  banco.tabelas.profiles = [{ id: 'perfil-1', user_id: MEMBRO, account_id: CONTA }]
  banco.tabelas.messages = [mensagem()]
  banco.tabelas.cb_conversation_notes = []
  banco.tabelas.cb_ia_turnos = [
    {
      id: TURNO,
      account_id: CONTA,
      conversation_id: CONVERSA,
      canal_id: CANAL,
      ia_agente_id: AGENTE,
      deal_id: CARD,
      stage_id: ETAPA,
      veio_de_passagem: false,
      mensagem_gatilho_id: GATILHO,
      mensagem_inicial_id: GATILHO,
      status: 'aguardando',
      executar_apos: haMs(1_000),
      rodando_desde: null,
      enviando_desde: null,
      mensagem_enviada_id: null,
      erro: null,
      terminado_em: null,
    },
  ]
  // A 1049: reivindica o pendente VENCIDO, e nunca com outro `rodando` na
  // conversa (o índice único parcial).
  banco.rpcs.cb_ia_reivindicar_turno = ({ p_turno_id }) => {
    const turnos = banco.tabelas.cb_ia_turnos
    const t = turnos.find(
      (x) => x.id === p_turno_id && x.status === 'aguardando' && Date.parse(x.executar_apos as string) <= Date.now(),
    )
    if (!t || turnos.some((x) => x.status === 'rodando' && x.conversation_id === t.conversation_id)) {
      return { data: [], error: null }
    }
    Object.assign(t, { status: 'rodando', rodando_desde: new Date().toISOString() })
    return { data: [{ ...t }], error: null }
  }
  // Enfileira ou empurra o pendente (conversa, conexão), com o agente, o card
  // e a etapa. `p_espera_ms` 0 (a passagem) = vencido na hora.
  banco.rpcs.cb_ia_enfileirar_turno = (a) => {
    const turnos = banco.tabelas.cb_ia_turnos
    let t = turnos.find(
      (x) => x.conversation_id === a.p_conversation_id && x.canal_id === a.p_canal_id && x.status === 'aguardando',
    )
    if (!t) {
      t = {
        id: `turno-${turnos.length + 1}`,
        account_id: a.p_account_id,
        conversation_id: a.p_conversation_id,
        canal_id: a.p_canal_id,
        mensagem_inicial_id: a.p_mensagem_id,
        status: 'aguardando',
        rodando_desde: null,
        enviando_desde: null,
        mensagem_enviada_id: null,
        erro: null,
        terminado_em: null,
      }
      turnos.push(t)
    }
    Object.assign(t, {
      ia_agente_id: a.p_ia_agente_id,
      deal_id: a.p_deal_id,
      stage_id: a.p_stage_id,
      veio_de_passagem: a.p_veio_de_passagem,
      mensagem_gatilho_id: a.p_mensagem_id,
      executar_apos: new Date(Date.now() - 1 + (a.p_espera_ms as number)).toISOString(),
    })
    return { data: [{ id: t.id, executar_apos: t.executar_apos }], error: null }
  }
  // A reserva do envio (1049): só o turno e a posse; o resto o banco lê. A
  // ordem e os nomes da recusa espelham o SQL: descartado, encerrada, pausada,
  // card_mudou, card_fechado, agente_desligado, fora_da_conexao,
  // agente_sem_etapa, mais_nova (OUTRO pendente da conexão com gatilho mais
  // novo — a prova de que a mensagem abre turno), robo_falou, teto. O teto
  // conta as respostas DO agente gravadas depois de
  // greatest(etapa_desde, ia_retomada_em).
  banco.rpcs.cb_ia_reservar_envio = ({ p_turno_id, p_rodando_desde }) => {
    const r = (data: string) => ({ data, error: null })
    const t = banco.tabelas.cb_ia_turnos.find((x) => x.id === p_turno_id)
    if (!t || t.status !== 'rodando' || t.rodando_desde !== p_rodando_desde) return r('descartado')
    const c = banco.tabelas.conversations.find((x) => x.id === t.conversation_id)
    if (!c || c.status === 'closed') return r('encerrada')
    if (c.ai_autoreply_disabled) return r('pausada')
    const d = banco.tabelas.deals.find((x) => x.id === t.deal_id)
    if (!d || d.stage_id !== t.stage_id) return r('card_mudou')
    if (d.status !== 'open') return r('card_fechado')
    const ag = banco.tabelas.cb_ia_agentes.find((x) => x.id === t.ia_agente_id)
    if (!ag || !ag.ativo || temValor(ag.arquivado_em)) return r('agente_desligado')
    if (!(ag.conexoes as string[]).includes(t.canal_id as string)) return r('fora_da_conexao')
    const e = banco.tabelas.cb_ia_agente_etapas.find((x) => x.stage_id === t.stage_id && x.ia_agente_id === t.ia_agente_id)
    if (!e) return r('agente_sem_etapa')
    const g = banco.tabelas.messages.find((m) => m.id === t.mensagem_gatilho_id)
    const maisNovo = (id: unknown) => {
      const n = banco.tabelas.messages.find((m) => m.id === id)
      return !!n && !temValor(n.deleted_at) && (!temValor(g?.gravada_em) || !temValor(n.gravada_em) || comparar(n.gravada_em, g?.gravada_em) > 0)
    }
    const outroPendente = banco.tabelas.cb_ia_turnos.some(
      (p) =>
        p.conversation_id === t.conversation_id &&
        p.canal_id === t.canal_id &&
        p.status === 'aguardando' &&
        p.id !== t.id &&
        maisNovo(p.mensagem_gatilho_id),
    )
    if (outroPendente) return r('mais_nova')
    const roboFalou = banco.tabelas.messages.some(
      (m) =>
        m.conversation_id === t.conversation_id &&
        m.channel_id === t.canal_id &&
        m.sender_type === 'bot' &&
        !temValor(m.ia_agente_id) &&
        !temValor(m.deleted_at) &&
        temValor(g?.gravada_em) &&
        temValor(m.gravada_em) &&
        comparar(m.gravada_em, g?.gravada_em) > 0,
    )
    if (roboFalou) return r('robo_falou')
    const desde = [d.etapa_desde, c.ia_retomada_em].filter(temValor).sort(comparar).at(-1)
    const respostas = banco.tabelas.messages.filter(
      (m) => m.conversation_id === c.id && m.ia_agente_id === t.ia_agente_id && temValor(m.gravada_em) && comparar(m.gravada_em, desde) > 0,
    ).length
    if (respostas >= (ag.teto_respostas as number)) return r('teto')
    return r('ok')
  }
}

const turno = (id = TURNO) => banco.tabelas.cb_ia_turnos.find((t) => t.id === id) as Linha
const conversa = () => banco.tabelas.conversations[0]
const card = () => banco.tabelas.deals[0]
const agenteLido = () => banco.tabelas.cb_ia_agentes[0]
const notas = () => banco.tabelas.cb_conversation_notes

beforeAll(() => {
  // A anotação sai no idioma da instalação: o teste confere o pt-BR.
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'pt-BR')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  montarCenario()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(obterAgente)
    .mockReset()
    .mockImplementation(async (conta, id) => {
      const l = banco.tabelas.cb_ia_agentes.find((x) => x.id === id && x.account_id === conta)
      return l ? lerLinhaDoAgente(l) : null
    })
  vi.mocked(lerChave).mockReset().mockResolvedValue({ chave: 'chave-gemini', ilegivel: false })
  vi.mocked(generateReply)
    .mockReset()
    .mockResolvedValue({
      text: 'Olá! Como posso ajudar?',
      handoff: false,
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    })
  vi.mocked(engineSendText)
    .mockReset()
    .mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      await args.aoSair?.('wamid.resposta')
      return { whatsapp_message_id: 'wamid.resposta' }
    })
  vi.mocked(transcreverAudio).mockReset()
  vi.mocked(checkRateLimit).mockReset().mockReturnValue({ success: true } as ReturnType<typeof checkRateLimit>)
  vi.mocked(drenarEventosDeFunil).mockClear()
  vi.mocked(after).mockReset()
})

/** O envio falha DEPOIS de chamar o provedor (o erro vem dele). */
function envioFalhaNoProvedor(err: unknown): void {
  vi.mocked(engineSendText).mockImplementation(async (args) => {
    args.antesDoProvedor?.()
    throw err
  })
}

/** Roda `antes` logo antes da reserva: depois da última conferência em JS. */
function antesDaReserva(antes: () => void): void {
  const reservaReal = banco.rpcs.cb_ia_reservar_envio
  banco.rpcs.cb_ia_reservar_envio = (args) => {
    antes()
    return reservaReal(args)
  }
}

/** A mensagem do agente que já respondeu na conversa (conta no teto). */
function respostaDoAgente(id: string, gravadaHaMs: number, agente = AGENTE): Linha {
  return mensagem({ id, sender_type: 'bot', ia_agente_id: agente, message_id: `wamid.${id}`, gravada_em: haMs(gravadaHaMs) })
}

// ------------------------------------------------------------
// nadaSaiu — a régua do "pode ter saído?"
// ------------------------------------------------------------

describe('nadaSaiu', () => {
  it('antes da primeira chamada ao provedor, nada saiu — qualquer erro', () => {
    expect(nadaSaiu(new Error('timeout'), false)).toBe(true)
    expect(nadaSaiu(new EvolutionApiError('x', 500), false)).toBe(true)
  })

  it('canal exigido indisponível: nada saiu', () => {
    expect(nadaSaiu(new CanalExigidoIndisponivelError(), true)).toBe(true)
  })

  it('Evolution: 4xx é recusa comprovada; 5xx pode ter saído', () => {
    expect(nadaSaiu(new EvolutionApiError('recusada', 400), true)).toBe(true)
    expect(nadaSaiu(new EvolutionApiError('recusada', 499), true)).toBe(true)
    expect(nadaSaiu(new EvolutionApiError('fora do ar', 500), true)).toBe(false)
    expect(nadaSaiu(new EvolutionApiError('gateway', 504), true)).toBe(false)
  })

  it('Meta: 4xx é recusa comprovada; 5xx pode ter saído', () => {
    expect(nadaSaiu(new MetaApiError('recusada', { httpStatus: 400 }), true)).toBe(true)
    expect(nadaSaiu(new MetaApiError('fora do ar', { httpStatus: 500 }), true)).toBe(false)
  })

  it('tempo esgotado ou erro de rede depois do provedor: pode ter saído', () => {
    expect(nadaSaiu(new Error('The operation was aborted due to timeout'), true)).toBe(false)
    expect(nadaSaiu(new TypeError('fetch failed'), true)).toBe(false)
  })
})

// ------------------------------------------------------------
// A reivindicação
// ------------------------------------------------------------

describe('executarTurno — a reivindicação', () => {
  it('turno ainda na espera da rajada não roda', async () => {
    turno().executar_apos = daquiMs(5_000)
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('com outro turno rodando na conversa, não roda (a rede tenta depois)', async () => {
    banco.tabelas.cb_ia_turnos.push({
      id: 'turno-ocupado',
      conversation_id: CONVERSA,
      status: 'rodando',
      rodando_desde: haMs(2_000),
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('depois do turno, roda o próximo pendente VENCIDO da mesma conversa', async () => {
    agenteLido().conexoes = [CANAL, OUTRO_CANAL]
    banco.tabelas.messages.push(mensagem({ id: 'msg-2', channel_id: OUTRO_CANAL, message_id: 'wamid.2' }))
    banco.tabelas.cb_ia_turnos.push({
      ...turno(),
      id: 'turno-2',
      canal_id: OUTRO_CANAL,
      mensagem_gatilho_id: 'msg-2',
      mensagem_inicial_id: 'msg-2',
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(turno('turno-2').status).toBe('respondeu')
    expect(engineSendText).toHaveBeenCalledTimes(2)
  })
})

// ------------------------------------------------------------
// O card e o agente da etapa (D24/D27)
// ------------------------------------------------------------

describe('executarTurno — o card e o agente da etapa (D24/D27)', () => {
  it('card na etapa do agente: responde, e a conversa passa a ter o agente (o último que respondeu)', async () => {
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'respondeu', mensagem_enviada_id: 'wamid.resposta' })
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ iaAgenteId: AGENTE }))
    expect(conversa().ia_agente_id).toBe(AGENTE)
  })

  it('o card mudou para uma etapa SEM agente antes de gerar: descarta, sem gerar', async () => {
    card().stage_id = 'etapa-meio'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'etapa_sem_agente' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o card mudou para a etapa de OUTRO agente: descarta (o turno é do agente da etapa de antes)', async () => {
    banco.tabelas.cb_ia_agentes.push(linhaDoAgente({ id: DESTINO, nome: 'Cobrança' }))
    banco.tabelas.cb_ia_agente_etapas.push({ stage_id: ETAPA_DESTINO, account_id: CONTA, ia_agente_id: DESTINO, desde: haMs(DIA) })
    card().stage_id = ETAPA_DESTINO
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o card mudou de etapa ou a etapa mudou de agente' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o card mudou para OUTRA etapa do MESMO agente: descarta (o turno é da etapa em que nasceu)', async () => {
    banco.tabelas.cb_ia_agente_etapas.push({ stage_id: ETAPA_DESTINO, account_id: CONTA, ia_agente_id: AGENTE, desde: haMs(DIA) })
    card().stage_id = ETAPA_DESTINO
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o card mudou de etapa ou a etapa mudou de agente' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('a etapa passou a ser de OUTRO agente: descarta', async () => {
    banco.tabelas.cb_ia_agentes.push(linhaDoAgente({ id: DESTINO, nome: 'Cobrança' }))
    banco.tabelas.cb_ia_agente_etapas[0].ia_agente_id = DESTINO
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o card mudou de etapa ou a etapa mudou de agente' })
  })

  it('o card mudou de etapa ENQUANTO o modelo pensava: não envia', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      card().stage_id = 'etapa-meio'
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('descartado')
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('o card mudou de etapa ENTRE a última conferência e a reserva: a reserva recusa (`card_mudou`), nada sai', async () => {
    antesDaReserva(() => (card().stage_id = 'etapa-meio'))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a reserva recusou o envio: card_mudou' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(notas()).toHaveLength(0)
  })

  it('o card foi GANHO (fechado): descarta — só card aberto', async () => {
    card().status = 'won'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'sem_card' })
  })

  it.each<[string, Linha, string]>([
    ['desligado', { ativo: false }, 'agente_desligado'],
    ['arquivado', { arquivado_em: haMs(1_000) }, 'agente_desligado'],
    ['sem esta conexão', { conexoes: [OUTRO_CANAL] }, 'fora_da_conexao'],
  ])('o agente %s: descarta, sem gerar', async (_rotulo, p, motivo) => {
    Object.assign(agenteLido(), p)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: motivo })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('D27: o agente foi religado DEPOIS de o card entrar na etapa: descarta', async () => {
    agenteLido().ativado_em = haMs(30_000)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'card_antigo' })
  })

  it('turno sem card (linha sem `deal_id`): descarta', async () => {
    turno().deal_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'turno sem agente, card ou conexão' })
  })
})

// ------------------------------------------------------------
// As conferências: descartar
// ------------------------------------------------------------

describe('executarTurno — descarta', () => {
  it('conversa pausada: pausado_no_meio, sem transferir', async () => {
    conversa().ai_autoreply_disabled = true
    await executarTurno(TURNO)
    expect(turno().status).toBe('pausado_no_meio')
    expect(notas()).toHaveLength(0)
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('conversa de grupo', async () => {
    conversa().group_id = 'grupo-1'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'fora_do_alcance' })
  })

  it('conversa ENCERRADA (uma automação a fechou na rajada)', async () => {
    conversa().status = 'closed'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'encerrada' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('a mensagem que abriu o turno foi apagada', async () => {
    banco.tabelas.messages[0].deleted_at = haMs(1_000)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a mensagem sumiu ou foi apagada' })
  })

  // A edição cifrada da Evolution 2.4 carimba `edited_at` e MANTÉM o texto
  // antigo: responder seria responder ao que o cliente já corrigiu.
  it('a mensagem que abriu o turno foi EDITADA na espera da rajada: descarta, sem gerar', async () => {
    banco.tabelas.messages[0].edited_at = haMs(1_000)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o cliente editou a mensagem' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o cliente EDITA a mensagem enquanto o modelo pensa: descarta, sem enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages[0].edited_at = new Date().toISOString()
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o cliente editou a mensagem' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('mensagem MAIS NOVA do cliente na mesma conexão (E10)', async () => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: haMs(5_000), message_id: 'wamid.nova' }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('mensagem mais nova em OUTRA conexão NÃO descarta', async () => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-outra', channel_id: OUTRO_CANAL, gravada_em: haMs(5_000) }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  // A MESMA régua do portão da entrada (`abreTurno`), sobre a linha GRAVADA.
  it.each<[string, Linha]>([
    ['figurinha', { content_type: 'image', content_text: null, media_type: 'image/webp' }],
    ['cartão de contato / enquete (texto nulo)', { content_type: 'text', content_text: null }],
    ['texto sem nada visível', { content_type: 'text', content_text: ' \n￼ ' }],
    ['localização', { content_type: 'location', content_text: 'Rua X' }],
    ['toque em botão (Meta)', { content_type: 'interactive', content_text: 'Sim' }],
    ['texto APAGADO', { content_text: 'deixa pra lá', deleted_at: haMs(1_000) }],
  ])('mensagem mais nova que não abre turno NÃO descarta: %s', async (_rotulo, p) => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: haMs(5_000), message_id: 'wamid.nova', ...p }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('a figurinha no meio da rajada não esconde o texto que veio depois dela', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-fig', content_type: 'image', content_text: null, media_type: 'image/webp', gravada_em: haMs(6_000) }),
      mensagem({ id: 'msg-txt', content_text: 'e aí?', gravada_em: haMs(5_000) }),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
  })

  it('o cliente escreve ENQUANTO o modelo pensa: descarta antes de enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: new Date().toISOString() }))
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('o cliente escreve ENTRE a última conferência e a reserva (a entrada enfileirou o pendente dela): `mais_nova`, nada sai', async () => {
    antesDaReserva(() => {
      banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: new Date().toISOString() }))
      banco.tabelas.cb_ia_turnos.push({
        ...turno(),
        id: 'turno-novo',
        status: 'aguardando',
        mensagem_gatilho_id: 'msg-nova',
        executar_apos: daquiMs(8_000),
      })
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a reserva recusou o envio: mais_nova' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('o cliente APAGA a mensagem enquanto o modelo pensa: descarta, sem enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages[0].deleted_at = new Date().toISOString()
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o cliente apagou a mensagem' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('o advogado responde ENQUANTO o modelo pensa (o gatilho pausou): pausado_no_meio, sem enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente' })
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('pausado_no_meio')
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ia_pausada_por).toBe('gente')
  })

  // O robô ou uma automação respondeu DEPOIS da mensagem (E4): o cliente toca
  // num botão na rajada, a automação responde, e o turno não responde de novo.
  it('o robô ou uma automação respondeu depois da mensagem: descarta, sem gerar', async () => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-automacao', sender_type: 'bot', gravada_em: haMs(9_000) }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('a automação responde ENQUANTO o modelo pensa: descarta antes de enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages.push(mensagem({ id: 'msg-automacao', sender_type: 'bot', gravada_em: new Date().toISOString() }))
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it.each<[string, Linha]>([
    ['por OUTRA conexão (D4)', { sender_type: 'bot', channel_id: OUTRO_CANAL, gravada_em: haMs(9_000) }],
    ['do PRÓPRIO agente (bot com ia_agente_id)', { sender_type: 'bot', ia_agente_id: AGENTE, gravada_em: haMs(9_000) }],
    ['APAGADA', { sender_type: 'bot', gravada_em: haMs(9_000), deleted_at: haMs(5_000) }],
    ['ANTES da mensagem do cliente', { sender_type: 'bot', gravada_em: haMs(60_000) }],
  ])('saída do robô %s não descarta', async (_rotulo, p) => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-saida', ...p }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('erro de leitura no meio vira `falhou` com o motivo (o turno nunca lança)', async () => {
    banco.falhas.push({ tabela: 'conversations', op: 'select', erro: { message: 'timeout do PostgREST' } })
    await expect(executarTurno(TURNO)).resolves.toBeUndefined()
    expect(turno().status).toBe('falhou')
    expect(String(turno().erro)).toContain('leitura da conversa falhou')
  })
})

// ------------------------------------------------------------
// Horário, teto e limite da conta
// ------------------------------------------------------------

describe('executarTurno — horário, teto e limite', () => {
  it('fora do horário do agente: não gera nem transfere', async () => {
    const hoje = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date())
    const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(hoje)
    agenteLido().horario = { dias: [(dia + 1) % 7], inicio: '00:00', fim: '23:59' }
    await executarTurno(TURNO)
    expect(turno().status).toBe('fora_do_horario')
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('teto: o agente já deu as respostas do teto desde que o card entrou na etapa — transfere (`teto`), sem enviar', async () => {
    agenteLido().teto_respostas = 2
    banco.tabelas.messages.push(respostaDoAgente('r1', 50_000), respostaDoAgente('r2', 40_000))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'teto' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia' })
    expect(notas()).toHaveLength(1)
  })

  it('o teto conta desde que o card ENTROU na etapa: respostas de antes não contam', async () => {
    agenteLido().teto_respostas = 2
    banco.tabelas.messages.push(respostaDoAgente('r1', 5 * 60_000), respostaDoAgente('r2', 4 * 60_000))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('o teto conta desde o "Retomar IA" (`ia_retomada_em`)', async () => {
    agenteLido().teto_respostas = 2
    banco.tabelas.messages.push(respostaDoAgente('r1', 50_000), respostaDoAgente('r2', 40_000))
    conversa().ia_retomada_em = haMs(30_000)
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('respostas de OUTRO agente não contam no teto deste', async () => {
    agenteLido().teto_respostas = 2
    banco.tabelas.messages.push(respostaDoAgente('r1', 50_000, DESTINO), respostaDoAgente('r2', 40_000, DESTINO))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('o advogado responde DEPOIS da última conferência e antes da reserva: a reserva recusa (`pausada`), nada sai', async () => {
    antesDaReserva(() => Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente' }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'pausado_no_meio' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('a conversa foi encerrada logo antes da reserva: descarta, nada sai', async () => {
    antesDaReserva(() => Object.assign(conversa(), { status: 'closed' }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a reserva recusou o envio: encerrada' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('limite de respostas por minuto da conta: sem resposta, sem gerar e sem transferir', async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ success: false } as ReturnType<typeof checkRateLimit>)
    await executarTurno(TURNO)
    expect(turno().status).toBe('sem_resposta')
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })
})

// ------------------------------------------------------------
// A reserva do envio: a última palavra é do banco
// ------------------------------------------------------------

describe('executarTurno — a reserva', () => {
  it('passa só o turno e a posse (o banco lê o resto)', async () => {
    await executarTurno(TURNO)
    const chamada = banco.rpcChamadas.find((c) => c.nome === 'cb_ia_reservar_envio')
    expect(chamada?.args).toEqual({ p_turno_id: TURNO, p_rodando_desde: expect.any(String) })
    expect(chamada?.args.p_rodando_desde).toBe(turno().rodando_desde)
  })

  it('a entrada descarta o turno ENQUANTO o modelo pensa: a reserva recusa, nada sai, e o registro da entrada fica', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      Object.assign(turno(), { status: 'descartado', erro: 'o robô ou uma automação respondeu' })
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(engineSendText).not.toHaveBeenCalled()
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
  })

  it('o turno é descartado ENTRE a reserva e a posse: nada sai (abandonado)', async () => {
    const reservaReal = banco.rpcs.cb_ia_reservar_envio
    banco.rpcs.cb_ia_reservar_envio = (args) => {
      const r = reservaReal(args)
      Object.assign(turno(), { status: 'descartado', erro: 'o robô ou uma automação respondeu' })
      return r
    }
    await executarTurno(TURNO)
    expect(engineSendText).not.toHaveBeenCalled()
    expect(turno()).toMatchObject({ status: 'descartado', enviando_desde: null })
  })

  it('a automação responde entre a última conferência e a reserva: `robo_falou`, nada sai', async () => {
    antesDaReserva(() =>
      banco.tabelas.messages.push(mensagem({ id: 'msg-automacao', sender_type: 'bot', gravada_em: new Date().toISOString() })),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a reserva recusou o envio: robo_falou' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('resultado que o código não conhece: descarta — nada sai e nada é transferido', async () => {
    banco.rpcs.cb_ia_reservar_envio = () => ({ data: 'coisa_nova', error: null })
    await executarTurno(TURNO)
    expect(turno().status).toBe('descartado')
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
    expect(notas()).toHaveLength(0)
  })

  it('erro da reserva: falhou, sem enviar e sem transferir', async () => {
    banco.rpcs.cb_ia_reservar_envio = () => ({ data: null, error: { message: 'lock timeout' } })
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(engineSendText).not.toHaveBeenCalled()
    expect(notas()).toHaveLength(0)
  })
})

// ------------------------------------------------------------
// O sentinela transfere para gente
// ------------------------------------------------------------

describe('executarTurno — o sentinela transfere para gente', () => {
  beforeEach(() => {
    vi.mocked(generateReply).mockResolvedValue({ text: '', handoff: true, usage: null })
  })

  it('pausa por transferência, atribui o destino e deixa a anotação da IA', async () => {
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(turno().terminado_em).toEqual(expect.any(String))
    expect(conversa()).toMatchObject({
      ai_autoreply_disabled: true,
      ia_pausada_por: 'transferencia',
      assigned_agent_id: MEMBRO,
    })
    expect(conversa().ia_pausada_em).toEqual(expect.any(String))
    expect(notas()).toHaveLength(1)
    expect(notas()[0]).toMatchObject({
      account_id: CONTA,
      conversation_id: CONVERSA,
      contact_id: 'contato-1',
      author_user_id: null,
      autor_nome: 'IA · Triagem',
    })
    expect(String(notas()[0].texto)).toContain('Triagem')
    expect(engineSendText).not.toHaveBeenCalled()
    expect(banco.rpcChamadas.some((c) => c.nome === 'cb_ia_reservar_envio')).toBe(false)
  })

  it('resposta vazia também transfere', async () => {
    vi.mocked(generateReply).mockResolvedValue({ text: '   ', handoff: false, usage: null })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
  })

  it('o advogado respondeu ENQUANTO o modelo pensava e o modelo pediu transferência: a pausa de gente fica', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente', ia_pausada_em: haMs(1_000) })
      return { text: '', handoff: true, usage: null }
    })
    await executarTurno(TURNO)
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'gente', assigned_agent_id: null })
    expect(notas()).toHaveLength(0)
    expect(turno().status).toBe('pausado_no_meio')
    expect(String(turno().erro)).toContain('não transferiu (sentinela)')
  })

  it('nunca tira a conversa de quem já é responsável', async () => {
    conversa().assigned_agent_id = 'advogado-2'
    await executarTurno(TURNO)
    expect(conversa().assigned_agent_id).toBe('advogado-2')
    expect(notas()).toHaveLength(1)
  })

  it('destino que não é mais membro da conta não é atribuído (a pausa e a nota ficam)', async () => {
    banco.tabelas.profiles = []
    await executarTurno(TURNO)
    expect(conversa().assigned_agent_id).toBeNull()
    expect(conversa().ia_pausada_por).toBe('transferencia')
    expect(notas()).toHaveLength(1)
  })

  it('sem destino configurado: fila sem responsável, sem ler perfis', async () => {
    agenteLido().transferir_para = null
    await executarTurno(TURNO)
    expect(conversa().assigned_agent_id).toBeNull()
    expect(banco.chamadas.some((c) => c.tabela === 'profiles')).toBe(false)
  })

  it('a geração é registrada no uso mesmo transferindo', async () => {
    vi.mocked(generateReply).mockResolvedValue({
      text: '',
      handoff: true,
      usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
    })
    await executarTurno(TURNO)
    expect(logAiUsage).toHaveBeenCalledWith(
      banco,
      expect.objectContaining({ mode: 'agente', iaAgenteId: AGENTE, turnoId: TURNO }),
    )
  })
})

describe('transferirParaGente', () => {
  const args = {
    accountId: CONTA,
    conversationId: CONVERSA,
    contactId: 'contato-1',
    nomeDoAgente: 'Triagem',
    transferirPara: MEMBRO,
    motivo: 'sentinela' as const,
  }

  it('a conversa de OUTRA conta: nada muda', async () => {
    await expect(transferirParaGente(banco as never, { ...args, accountId: 'outra-conta' })).resolves.toBe('nada_mudou')
    expect(conversa().ai_autoreply_disabled).toBe(false)
    expect(notas()).toHaveLength(0)
  })

  it('a conversa ENCERRADA: nada muda', async () => {
    conversa().status = 'closed'
    await expect(transferirParaGente(banco as never, args)).resolves.toBe('nada_mudou')
    expect(conversa().ai_autoreply_disabled).toBe(false)
    expect(notas()).toHaveLength(0)
  })

  it('erro ao pausar: nada mais é escrito, e não lança', async () => {
    banco.falhas.push({ tabela: 'conversations', op: 'update', erro: { message: 'falhou' } })
    await expect(transferirParaGente(banco as never, args)).resolves.toBe('falhou')
    expect(notas()).toHaveLength(0)
  })

  it('pausa, atribui e anota: `transferiu` — mesmo na conversa que a IA ainda não respondeu', async () => {
    await expect(transferirParaGente(banco as never, args)).resolves.toBe('transferiu')
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia', assigned_agent_id: MEMBRO })
    expect(notas()).toHaveLength(1)
  })

  it.each(['gente', 'botao', 'transferencia', 'automacao'])(
    'a conversa JÁ pausada (%s): a pausa não é trocada, ninguém é atribuído e não há anotação',
    async (pausadaPor) => {
      const antes = haMs(60_000)
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: pausadaPor, ia_pausada_em: antes })
      await expect(transferirParaGente(banco as never, args)).resolves.toBe('nada_mudou')
      expect(conversa()).toMatchObject({ ia_pausada_por: pausadaPor, ia_pausada_em: antes, assigned_agent_id: null })
      expect(notas()).toHaveLength(0)
    },
  )
})

// ------------------------------------------------------------
// Falha de configuração NÃO transfere (E8)
// ------------------------------------------------------------

describe('executarTurno — falha de configuração termina `falhou` sem transferir (E8)', () => {
  function semTransferencia(): void {
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: false, ia_pausada_por: null })
    expect(notas()).toHaveLength(0)
    expect(engineSendText).not.toHaveBeenCalled()
  }

  it('sem chave do provedor', async () => {
    vi.mocked(lerChave).mockResolvedValue({ chave: null, ilegivel: false })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'sem chave do provedor gemini' })
    expect(generateReply).not.toHaveBeenCalled()
    semTransferencia()
  })

  it('chave que não decifra', async () => {
    vi.mocked(lerChave).mockResolvedValue({ chave: null, ilegivel: true })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'a chave do provedor não decifra' })
    semTransferencia()
  })

  it('a leitura da chave falhou', async () => {
    vi.mocked(lerChave).mockRejectedValue(new Error('rede'))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'leitura da chave falhou' })
    semTransferencia()
  })

  it('o provedor recusou a chave — o motivo gravado não ecoa a chave', async () => {
    vi.mocked(generateReply).mockRejectedValue(
      new AiError('Incorrect API key provided: sk-…abcd', { code: 'invalid_key', status: 401 }),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'o provedor recusou a chave' })
    semTransferencia()
  })

  it('o provedor fora do ar (modelo, cota, rede)', async () => {
    vi.mocked(generateReply).mockRejectedValue(new AiError('model not found', { code: 'ai_error' }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'model not found' })
    semTransferencia()
  })

  it('erro inesperado na geração', async () => {
    vi.mocked(generateReply).mockRejectedValue(new TypeError('boom'))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'erro inesperado ao gerar' })
    semTransferencia()
  })
})

// ------------------------------------------------------------
// O envio
// ------------------------------------------------------------

describe('executarTurno — o envio', () => {
  it('sucesso: respondeu, com o id do provedor, e o canal EXIGIDO', async () => {
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({
      status: 'respondeu',
      mensagem_enviada_id: 'wamid.resposta',
      iteracoes: 1,
      tokens_entrada: 100,
      tokens_saida: 20,
      tokens_total: 120,
      erro: null,
    })
    expect(turno().enviando_desde).toEqual(expect.any(String))
    expect(turno().terminado_em).toEqual(expect.any(String))
    expect(engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: CONTA,
        userId: 'dono-1',
        conversationId: CONVERSA,
        contactId: 'contato-1',
        text: 'Olá! Como posso ajudar?',
        aiGenerated: true,
        preferredChannelId: CANAL,
        exigirCanal: true,
        iaAgenteId: AGENTE,
      }),
    )
    expect(notas()).toHaveLength(0)
    expect(mostrarDigitando).toHaveBeenCalledWith(
      banco,
      expect.objectContaining({ channelId: CANAL, inboundMessageId: 'wamid.cliente' }),
    )
  })

  it('o "digitando…" termina ANTES de a resposta sair, e é cancelado em seguida (revisão do PR #288)', async () => {
    const ordem: string[] = []
    let sinal: AbortSignal | undefined
    vi.mocked(mostrarDigitando).mockImplementationOnce(async (_db, args) => {
      sinal = args.sinal
      await new Promise((r) => setTimeout(r, 20))
      ordem.push('digitando')
      return 'enviado'
    })
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      ordem.push(sinal?.aborted ? 'envio (digitando cancelado)' : 'envio (digitando em voo)')
      args.antesDoProvedor?.()
      await args.aoSair?.('wamid.resposta')
      return { whatsapp_message_id: 'wamid.resposta' }
    })
    await executarTurno(TURNO)
    expect(ordem).toEqual(['digitando', 'envio (digitando cancelado)'])
    expect(turno().status).toBe('respondeu')
  })

  it('saída SEM envio (o sentinela) cancela o "digitando…" ainda em voo', async () => {
    let sinal: AbortSignal | undefined
    vi.mocked(mostrarDigitando).mockImplementationOnce(
      (_db, args) =>
        new Promise((resolve) => {
          sinal = args.sinal
          args.sinal?.addEventListener('abort', () => resolve('pulado'))
        }),
    )
    vi.mocked(generateReply).mockResolvedValueOnce({ text: '', handoff: true, usage: null })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(sinal?.aborted).toBe(true)
  })

  it('o id do provedor é gravado ANTES de o envio voltar (o eco o consulta, E5)', async () => {
    let gravadoAntes: unknown = 'nao-conferido'
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      await args.aoSair?.('wamid.resposta')
      gravadoAntes = turno().mensagem_enviada_id
      return { whatsapp_message_id: 'wamid.resposta' }
    })
    await executarTurno(TURNO)
    expect(gravadoAntes).toBe('wamid.resposta')
  })

  it.each<[string, () => void]>([
    ['recusa 4xx da Evolution', () => envioFalhaNoProvedor(new EvolutionApiError('número inválido', 400))],
    ['recusa 4xx da Meta', () => envioFalhaNoProvedor(new MetaApiError('recusada', { httpStatus: 400 }))],
    ['conexão exigida indisponível', () => vi.mocked(engineSendText).mockRejectedValue(new CanalExigidoIndisponivelError())],
    ['erro antes do provedor', () => vi.mocked(engineSendText).mockRejectedValue(new Error('contact not found for this account'))],
  ])('%s: falhou, sem transferir, e a conversa não ganha agente', async (_rotulo, falhar) => {
    falhar()
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(conversa().ai_autoreply_disabled).toBe(false)
    expect(conversa().ia_agente_id).toBeNull()
    expect(notas()).toHaveLength(0)
  })

  it.each([
    ['5xx da Evolution', new EvolutionApiError('bad gateway', 502)],
    ['5xx da Meta', new MetaApiError('internal', { httpStatus: 500 })],
    ['tempo esgotado', new Error('The operation was aborted due to timeout')],
  ])('%s depois de chamar o provedor: incerto e transfere', async (_rotulo, err) => {
    envioFalhaNoProvedor(err)
    await executarTurno(TURNO)
    expect(turno().status).toBe('incerto')
    expect(String(turno().erro)).toContain('não dá para saber se saiu')
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia' })
    expect(notas()).toHaveLength(1)
    expect(String(notas()[0].texto)).toContain('não dá para saber se a última resposta chegou')
  })

  it('incerto com a conversa já pausada por gente: o `incerto` fica (fala do envio), sem trocar a pausa nem anotar', async () => {
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente' })
      throw new EvolutionApiError('bad gateway', 502)
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('incerto')
    expect(conversa().ia_pausada_por).toBe('gente')
    expect(notas()).toHaveLength(0)
  })

  it('saiu e o registro falhou: respondeu, com o erro — nunca reenvia; a conversa ganha o agente', async () => {
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      await args.aoSair?.('wamid.saiu')
      throw new EnviadaSemRegistroError('wamid.saiu', 'insert timeout')
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'respondeu', mensagem_enviada_id: 'wamid.saiu' })
    expect(String(turno().erro)).toContain('insert timeout')
    expect(conversa().ia_agente_id).toBe(AGENTE)
    expect(notas()).toHaveLength(0)
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })

  it('perda da posse (o recolhedor tomou a linha): a reserva recusa, não envia nem escreve por cima', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      Object.assign(turno(), { status: 'falhou', rodando_desde: '1999-01-01T00:00:00.000Z', erro: 'recolhido' })
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(engineSendText).not.toHaveBeenCalled()
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'recolhido', enviando_desde: null })
    expect(notas()).toHaveLength(0)
  })

  it('a conta sem dono: falhou, sem enviar e sem reservar', async () => {
    banco.tabelas.accounts[0].owner_user_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'a conta não tem dono' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(banco.rpcChamadas.some((c) => c.nome === 'cb_ia_reservar_envio')).toBe(false)
  })

  it('conversa sem contato: descarta (sem contato não há card), sem gerar', async () => {
    conversa().contact_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'sem_card' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o recolhedor tomou o turno NO MEIO do envio: o id do provedor é gravado assim mesmo (o eco o lê), e o desfecho dele fica', async () => {
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      Object.assign(turno(), {
        status: 'incerto',
        rodando_desde: '1999-01-01T00:00:00.000Z',
        erro: 'recolhido no meio do envio',
      })
      await args.aoSair?.('wamid.resposta')
      return { whatsapp_message_id: 'wamid.resposta' }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({
      status: 'incerto',
      erro: 'recolhido no meio do envio',
      mensagem_enviada_id: 'wamid.resposta',
    })
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })

  it('o id do provedor não sobrescreve um id já gravado', async () => {
    let depoisDoAoSair: unknown = 'nao-conferido'
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      turno().mensagem_enviada_id = 'wamid.outro'
      await args.aoSair?.('wamid.resposta')
      depoisDoAoSair = turno().mensagem_enviada_id
      return { whatsapp_message_id: 'wamid.resposta' }
    })
    await executarTurno(TURNO)
    expect(depoisDoAoSair).toBe('wamid.outro')
  })
})

// ------------------------------------------------------------
// A PASSAGEM (D25)
// ------------------------------------------------------------

describe('executarTurno — a passagem (D25)', () => {
  /** O agente de destino ("Cobrança"), dono de uma etapa. */
  function comDestino(p: Linha = {}, etapas: Linha[] = [{ stage_id: ETAPA_DESTINO }]): void {
    agenteLido().pode_passar_para = [DESTINO]
    banco.tabelas.cb_ia_agentes.push(linhaDoAgente({ id: DESTINO, nome: 'Cobrança', descricao: 'boletos', ...p }))
    for (const e of etapas) {
      banco.tabelas.cb_ia_agente_etapas.push({ account_id: CONTA, ia_agente_id: DESTINO, desde: haMs(DIA), ...e })
    }
  }

  /** A triagem passa (`[[PASSAR:n]]`); o destino, chamado depois, responde. */
  function triagemPassa(n = 1): void {
    vi.mocked(generateReply)
      .mockResolvedValueOnce({ text: `[[PASSAR:${n}]]`, handoff: false, usage: null })
      .mockResolvedValue({ text: 'Aqui é a Cobrança, segue o boleto.', handoff: false, usage: null })
  }

  const turnoDoDestino = () => banco.tabelas.cb_ia_turnos.find((t) => t.id !== TURNO) as Linha | undefined

  it('o pedido da triagem lista os agentes para quem ela pode passar', async () => {
    comDestino()
    await executarTurno(TURNO)
    const pedido = vi.mocked(generateReply).mock.calls[0][0].systemPrompt
    expect(pedido).toContain('[[PASSAR:n]]')
    expect(pedido).toContain('1. Cobrança — boletos')
  })

  it('agente desligado, arquivado ou sem a conexão NÃO é oferecido', async () => {
    comDestino({ conexoes: [OUTRO_CANAL] })
    await executarTurno(TURNO)
    expect(vi.mocked(generateReply).mock.calls[0][0].systemPrompt).not.toContain('PASSAR')
  })

  it('passa: o card vai para a etapa do destino (no MESMO funil), fica a anotação, e o destino responde à MESMA mensagem', async () => {
    comDestino()
    triagemPassa()
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'passou', erro: null })
    expect(card()).toMatchObject({ pipeline_id: FUNIL, stage_id: ETAPA_DESTINO })
    expect(drenarEventosDeFunil).toHaveBeenCalledTimes(1)
    expect(notas()).toHaveLength(1)
    expect(notas()[0]).toMatchObject({ author_user_id: null, autor_nome: 'IA · Triagem', contact_id: 'contato-1' })
    expect(String(notas()[0].texto)).toContain('IA · Cobrança')
    // O turno do destino: mesma mensagem, marcado, sem espera — e já rodou
    // (por `rodarPendentesDaConversa`; o disparo agendado é a segunda porta).
    expect(after).toHaveBeenCalledTimes(1)
    expect(turnoDoDestino()).toMatchObject({
      ia_agente_id: DESTINO,
      deal_id: CARD,
      stage_id: ETAPA_DESTINO,
      veio_de_passagem: true,
      mensagem_gatilho_id: GATILHO,
      status: 'respondeu',
    })
    // Só o destino fala com o cliente; o marcador nunca sai.
    expect(engineSendText).toHaveBeenCalledTimes(1)
    expect(engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ iaAgenteId: DESTINO, text: 'Aqui é a Cobrança, segue o boleto.' }),
    )
    expect(conversa().ia_agente_id).toBe(DESTINO)
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it.each<[string, Linha]>([
    ['escuta a etapa de destino', { trigger_config: { stage_ids: [ETAPA_DESTINO] } }],
    ['escuta TODA etapa', { trigger_config: { stage_ids: [] } }],
  ])('automação ligada que %s: ela fala, e o destino NÃO responde a esta mensagem (E4)', async (_rotulo, p) => {
    banco.tabelas.automations = [
      { id: 'auto-destino', account_id: CONTA, trigger_type: 'deal_stage_changed', is_active: true, ...p },
    ]
    comDestino()
    triagemPassa()
    await executarTurno(TURNO)
    expect(turno().status).toBe('passou')
    expect(card().stage_id).toBe(ETAPA_DESTINO)
    expect(drenarEventosDeFunil).toHaveBeenCalledTimes(1)
    expect(notas()).toHaveLength(1)
    expect(turnoDoDestino()).toBeUndefined()
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('automação DESLIGADA ou de outra etapa não segura o destino', async () => {
    banco.tabelas.automations = [
      { id: 'a1', account_id: CONTA, trigger_type: 'deal_stage_changed', is_active: false, trigger_config: { stage_ids: [ETAPA_DESTINO] } },
      { id: 'a2', account_id: CONTA, trigger_type: 'deal_stage_changed', is_active: true, trigger_config: { stage_ids: ['outra'] } },
    ]
    comDestino()
    triagemPassa()
    await executarTurno(TURNO)
    expect(turnoDoDestino()?.status).toBe('respondeu')
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })

  it('a etapa de destino é a de MENOR posição do destino no funil do card', async () => {
    comDestino({}, [{ stage_id: ETAPA_DESTINO }, { stage_id: 'etapa-meio' }])
    triagemPassa()
    await executarTurno(TURNO)
    expect(card().stage_id).toBe('etapa-meio')
  })

  it('o destino não atua no funil do card: a primeira etapa dele no funil mais antigo', async () => {
    banco.tabelas.pipelines.push({ id: 'funil-novo', created_at: haMs(DIA) }, { id: 'funil-velho', created_at: haMs(500 * DIA) })
    banco.tabelas.pipeline_stages.push(
      { id: 'novo-0', pipeline_id: 'funil-novo', position: 0 },
      { id: 'velho-3', pipeline_id: 'funil-velho', position: 3 },
      { id: 'velho-1', pipeline_id: 'funil-velho', position: 1 },
    )
    comDestino({}, [{ stage_id: 'novo-0' }, { stage_id: 'velho-3' }, { stage_id: 'velho-1' }])
    triagemPassa()
    await executarTurno(TURNO)
    expect(card()).toMatchObject({ pipeline_id: 'funil-velho', stage_id: 'velho-1' })
    expect(turno().status).toBe('passou')
  })

  it('o marcador no meio de um texto também é passagem — e o texto nunca chega ao cliente', async () => {
    comDestino()
    vi.mocked(generateReply)
      .mockResolvedValueOnce({ text: 'Vou te passar para a Cobrança. [[PASSAR:1]]', handoff: false, usage: null })
      .mockResolvedValue({ text: 'Oi, Cobrança aqui.', handoff: false, usage: null })
    await executarTurno(TURNO)
    expect(turno().status).toBe('passou')
    expect(engineSendText).toHaveBeenCalledTimes(1)
    expect(engineSendText).toHaveBeenCalledWith(expect.objectContaining({ iaAgenteId: DESTINO }))
  })

  it('passagem de passagem (o turno nascido de passagem tenta passar de novo): transfere para gente', async () => {
    comDestino()
    turno().veio_de_passagem = true
    triagemPassa()
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(card().stage_id).toBe(ETAPA)
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia' })
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it.each<[string, () => void]>([
    ['número fora da lista', () => triagemPassa(2)],
    ['nenhum agente para passar e o modelo inventa um', () => {
      agenteLido().pode_passar_para = []
      triagemPassa(1)
    }],
  ])('agente n inválido (%s): transfere para gente, o card fica', async (_rotulo, montar) => {
    comDestino()
    montar()
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(card().stage_id).toBe(ETAPA)
    expect(turnoDoDestino()).toBeUndefined()
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('o destino não atua em etapa nenhuma: transfere para gente', async () => {
    comDestino({}, [])
    triagemPassa()
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(card().stage_id).toBe(ETAPA)
  })

  it('o card saiu da etapa entre a conferência e o movimento (o UPDATE condicional não casa): transfere para gente', async () => {
    comDestino()
    triagemPassa()
    banco.antes = (tabela, op) => {
      if (tabela === 'deals' && op === 'update') card().status = 'won'
    }
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
    expect(card().stage_id).toBe(ETAPA)
    expect(turnoDoDestino()).toBeUndefined()
  })

  it('o card mudou de etapa ENQUANTO o modelo pensava: descarta, sem passar nem transferir', async () => {
    comDestino()
    vi.mocked(generateReply).mockImplementation(async () => {
      card().stage_id = 'etapa-meio'
      return { text: '[[PASSAR:1]]', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('descartado')
    expect(card().stage_id).toBe('etapa-meio')
    expect(notas()).toHaveLength(0)
  })

  it('erro ao mover o card: falhou, sem transferir', async () => {
    comDestino()
    triagemPassa()
    banco.falhas.push({ tabela: 'deals', op: 'update', erro: { message: 'timeout' } })
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('a fila recusa o turno do destino: TRANSFERE para gente (o card já mudou e ninguém responderia) — Codex, #309', async () => {
    comDestino()
    triagemPassa()
    banco.rpcs.cb_ia_enfileirar_turno = () => ({ data: null, error: { message: 'lock timeout' } })
    await executarTurno(TURNO)
    expect(turno().status).toBe('transferiu')
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia' })
    expect(card().stage_id).toBe(ETAPA_DESTINO)
  })
})

// ------------------------------------------------------------
// A fala adiada do funil na rajada (E4)
// ------------------------------------------------------------

// A primeira mensagem criou o card (o roteador grava o evento de funil; a
// boas-vindas da etapa roda no DRENO). A mensagem seguinte da rajada abre
// turno, e a IA responderia antes da boas-vindas. O turno reagenda enquanto
// há evento deste contato ainda não drenado cuja etapa tem quem escute — por
// até a janela (2 min do gatilho). `etapaTemQuemFale` roda de verdade.
describe('executarTurno — a fala adiada do funil (E4)', () => {
  const ETAPA_LEAD = 'etapa-lead'

  function automacaoDaEtapa(p: Linha = {}): Linha {
    return {
      id: 'auto-boas-vindas',
      account_id: CONTA,
      trigger_type: 'deal_stage_changed',
      trigger_config: { stage_ids: [ETAPA_LEAD] },
      is_active: true,
      ...p,
    }
  }

  function evento(p: Linha = {}): Linha {
    return {
      id: 'ev-1',
      account_id: CONTA,
      tipo: 'deal_stage_changed',
      contact_id: 'contato-1',
      deal_id: CARD,
      to_stage_id: ETAPA_LEAD,
      processado_em: null,
      criado_em: haMs(21_000),
      ...p,
    }
  }

  const leuEventos = () => banco.chamadas.some((c) => c.tabela === 'cb_automation_events')

  beforeEach(() => {
    banco.tabelas.automations = [automacaoDaEtapa()]
    banco.tabelas.cb_automation_events = [evento()]
  })

  it.each<[string, Linha]>([
    ['automação que escuta a etapa', {}],
    ['automação sem etapas (escuta TODA etapa)', { trigger_config: { stage_ids: [] } }],
  ])('evento pendente com %s: REAGENDA, sem gerar', async (_rotulo, p) => {
    banco.tabelas.automations = [automacaoDaEtapa(p)]
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'aguardando', rodando_desde: null })
    expect(Date.parse(turno().executar_apos as string)).toBeGreaterThan(Date.now())
    expect(after).toHaveBeenCalledTimes(1)
    expect(generateReply).not.toHaveBeenCalled()
    expect(engineSendText).not.toHaveBeenCalled()
    expect(notas()).toHaveLength(0)
  })

  it.each<[string, () => void]>([
    ['ninguém escuta a etapa', () => (banco.tabelas.automations = [automacaoDaEtapa({ trigger_config: { stage_ids: ['outra-etapa'] } })])],
    ['a automação da etapa está DESLIGADA', () => (banco.tabelas.automations = [automacaoDaEtapa({ is_active: false })])],
    ['o evento já foi PROCESSADO', () => (banco.tabelas.cb_automation_events = [evento({ processado_em: haMs(2_000) })])],
    ['o evento é de OUTRO contato', () => (banco.tabelas.cb_automation_events = [evento({ contact_id: 'contato-2' })])],
    ['o evento é de STATUS, não de etapa', () => (banco.tabelas.cb_automation_events = [evento({ tipo: 'deal_status_changed' })])],
  ])('%s: segue e responde', async (_rotulo, montar) => {
    montar()
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })

  it('fora da janela (o dreno falhou): segue, e nem lê os eventos', async () => {
    const velha = haMs(JANELA_DO_AUDIO_MS + 60_000)
    Object.assign(banco.tabelas.messages[0], { gravada_em: velha, created_at: velha })
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(leuEventos()).toBe(false)
  })

  it('leitura dos eventos que falha DENTRO da janela: reagenda (na dúvida, a automação fala)', async () => {
    banco.falhas.push({ tabela: 'cb_automation_events', op: 'select', erro: { message: 'timeout' } })
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o evento aparece ENQUANTO o modelo pensa: reagenda antes de enviar', async () => {
    banco.tabelas.cb_automation_events = []
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.cb_automation_events.push(evento())
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
    expect(engineSendText).not.toHaveBeenCalled()
  })

  it('na volta, drenado o evento e dada a boas-vindas: descarta — o cliente não recebe duas respostas', async () => {
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
    banco.tabelas.cb_automation_events[0].processado_em = new Date().toISOString()
    banco.tabelas.messages.push(mensagem({ id: 'msg-boas-vindas', sender_type: 'bot', gravada_em: new Date().toISOString() }))
    turno().executar_apos = haMs(1_000)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(generateReply).not.toHaveBeenCalled()
    expect(engineSendText).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// Áudio (E9)
// ------------------------------------------------------------

describe('executarTurno — áudio', () => {
  function gatilhoDeAudio(gravadaHaMs: number, p: Linha = {}): void {
    Object.assign(banco.tabelas.messages[0], {
      content_type: 'audio',
      content_text: null,
      gravada_em: haMs(gravadaHaMs),
      created_at: haMs(gravadaHaMs),
      ...p,
    })
  }

  it('arquivo ainda baixando, dentro da janela: REAGENDA (volta a aguardando)', async () => {
    gatilhoDeAudio(10_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'falhou', erro: 'o áudio ainda está sendo baixado' })
    await executarTurno(TURNO)
    expect(transcreverAudio).toHaveBeenCalledWith(banco, { accountId: CONTA, messageId: GATILHO })
    expect(turno()).toMatchObject({ status: 'aguardando', rodando_desde: null })
    expect(Date.parse(turno().executar_apos as string)).toBeGreaterThan(Date.now())
    expect(after).toHaveBeenCalledTimes(1)
    expect(generateReply).not.toHaveBeenCalled()
    expect(notas()).toHaveLength(0)
  })

  it('`transcrevendo` reagenda mesmo fora da janela', async () => {
    gatilhoDeAudio(JANELA_DO_AUDIO_MS + 60_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'transcrevendo' })
    await executarTurno(TURNO)
    expect(turno().status).toBe('aguardando')
  })

  it('falhou depois da janela: transfere (`audio`)', async () => {
    gatilhoDeAudio(JANELA_DO_AUDIO_MS + 60_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'falhou', erro: 'gemini fora do ar' })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'audio' })
    expect(conversa().ia_pausada_por).toBe('transferencia')
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('recusada: transfere (`audio`) na hora', async () => {
    gatilhoDeAudio(5_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'recusada', erro: 'áudio grande demais' })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'audio' })
    expect(notas()).toHaveLength(1)
  })

  it('pronta: segue e responde', async () => {
    gatilhoDeAudio(10_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'pronta', transcricao: 'quero falar do contrato' })
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('já transcrito: não chama a transcrição de novo', async () => {
    gatilhoDeAudio(10_000, { transcricao_status: 'pronta', transcricao: 'oi' })
    await executarTurno(TURNO)
    expect(transcreverAudio).not.toHaveBeenCalled()
    expect(turno().status).toBe('respondeu')
  })

  describe('o prazo acaba DEPOIS da transcrição', () => {
    // Só o `Date` é falso: o relógio anda 40 s dentro do dublê, como uma
    // transcrição (download + Gemini) que come o prazo de 45 s do turno.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date())
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    it('a transcrição AVANÇOU nesta rodada: REAGENDA (o turno seguinte começa com prazo cheio)', async () => {
      gatilhoDeAudio(10_000)
      vi.mocked(transcreverAudio).mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 40_000)
        return { status: 'pronta', transcricao: 'quero falar do contrato' }
      })
      await executarTurno(TURNO)
      expect(turno()).toMatchObject({ status: 'aguardando', rodando_desde: null })
      expect(generateReply).not.toHaveBeenCalled()
      expect(notas()).toHaveLength(0)
    })

    it('⚠️ nada foi transcrito nesta rodada: `falhou` — sem laço de reagendamento', async () => {
      gatilhoDeAudio(10_000, { transcricao_status: 'pronta', transcricao: 'oi' })
      vi.mocked(lerChave).mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 40_000)
        return { chave: 'chave-gemini', ilegivel: false }
      })
      await executarTurno(TURNO)
      expect(transcreverAudio).not.toHaveBeenCalled()
      expect(turno()).toMatchObject({ status: 'falhou', erro: 'o prazo do turno acabou antes de gerar' })
    })
  })

  it('⚠️ rajada com mais áudios que o teto: o GATILHO (o mais novo) é transcrito', async () => {
    gatilhoDeAudio(10_000)
    for (let i = 1; i <= 6; i++) {
      banco.tabelas.messages.push(
        mensagem({
          id: `audio-antigo-${i}`,
          message_id: `wamid.antigo-${i}`,
          content_type: 'audio',
          content_text: null,
          gravada_em: haMs(10_000 + i * 1_000),
          created_at: haMs(10_000 + i * 1_000),
        }),
      )
    }
    turno().mensagem_inicial_id = 'audio-antigo-6'
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'pronta', transcricao: 'oi' })
    await executarTurno(TURNO)
    const ouvidos = vi.mocked(transcreverAudio).mock.calls.map((c) => c[1].messageId)
    expect(ouvidos).toEqual(['audio-antigo-4', 'audio-antigo-3', 'audio-antigo-2', 'audio-antigo-1', GATILHO])
  })

  it('reagendar esbarra em outro pendente da conexão (23505): descarta', async () => {
    gatilhoDeAudio(10_000)
    vi.mocked(transcreverAudio).mockResolvedValue({ status: 'transcrevendo' })
    banco.falhas.push({
      tabela: 'cb_ia_turnos',
      op: 'update',
      erro: { message: 'duplicate key value violates unique constraint', code: '23505' },
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
    expect(after).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------
// O que o agente vê (F3): blocos de acesso, a base DELE e o retrato
// ------------------------------------------------------------

describe('executarTurno — o que o agente vê (F3)', () => {
  const pedido = () => vi.mocked(generateReply).mock.calls[0][0].systemPrompt as string

  function comEtiquetas(): void {
    agenteLido().acesso = { etiquetas: true, negocio: true }
    banco.tabelas.contact_tags = [{ contact_id: 'contato-1', tag_id: 'tag-1' }]
    banco.tabelas.tags = [{ id: 'tag-1', account_id: CONTA, name: 'bancário' }]
    banco.tabelas.pipelines[0].account_id = CONTA
    banco.tabelas.pipelines[0].name = 'Comercial'
    banco.tabelas.pipeline_stages[0].name = 'Triagem'
  }

  it('nada marcado e nenhum documento: o pedido não fala do cliente, e o retrato fica vazio', async () => {
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(pedido()).not.toContain('What you know about this customer')
    expect(turno().contexto).toEqual({ blocos: [], documentos: [] })
    // Nada marcado = nada lido.
    expect(banco.chamadas.some((c) => ['contacts', 'tags', 'contact_tags', 'cb_asaas_config'].includes(c.tabela))).toBe(false)
  })

  it('os blocos marcados entram no pedido — o negócio é o CARD do turno — e o retrato é gravado', async () => {
    comEtiquetas()
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(pedido()).toContain('What you know about this customer')
    expect(pedido()).toContain('Deal (open):\n- Pipeline: Comercial\n- Stage: Triagem')
    expect(pedido()).toContain('Tags: bancário')
    expect(turno().contexto).toEqual({
      blocos: [
        expect.objectContaining({ bloco: 'negocio' }),
        { bloco: 'etiquetas', texto: 'Tags: bancário' },
      ],
      documentos: [],
    })
  })

  it('⚠️ bloco que não se lê vai como "unavailable" e NÃO derruba o turno', async () => {
    comEtiquetas()
    banco.falhas.push({ tabela: 'contact_tags', op: 'select', erro: { message: 'timeout' } })
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(pedido()).toContain('Tags: unavailable right now.')
    expect(pedido()).toContain('- Stage: Triagem')
  })

  it('a base DO AGENTE: os trechos dos documentos dele entram, com o documento no retrato', async () => {
    banco.tabelas.cb_ia_agente_documentos = [{ account_id: CONTA, ia_agente_id: AGENTE, documento_id: 'doc-faq' }]
    banco.rpcs.cb_ia_buscar_conhecimento_fts = (a) => ({
      data:
        a.p_ia_agente_id === AGENTE && a.p_account_id === CONTA
          ? [{ id: 'chunk-1', documento_id: 'doc-faq', content: 'Atendemos das 9h às 18h.', score: 1 }]
          : [],
      error: null,
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(pedido()).toContain('[1] Atendemos das 9h às 18h.')
    expect(turno().contexto).toEqual({ blocos: [], documentos: ['doc-faq'] })
    // A consulta é a mensagem do cliente.
    expect(banco.rpcChamadas.find((r) => r.nome === 'cb_ia_buscar_conhecimento_fts')?.args.p_query).toBe(
      'Oi, preciso de ajuda',
    )
  })

  it('a base que falha fica vazia e o turno segue', async () => {
    banco.tabelas.cb_ia_agente_documentos = [{ account_id: CONTA, ia_agente_id: AGENTE, documento_id: 'doc-faq' }]
    // Sem a RPC registrada, o banco falso devolve erro (a função não existe).
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(pedido()).not.toContain('Reference material')
  })

  it('o retrato é gravado com a cerca de posse: turno recolhido no meio não é sobrescrito', async () => {
    comEtiquetas()
    banco.antes = (tabela, op) => {
      if (tabela === 'cb_ia_turnos' && op === 'update' && turno().status === 'rodando' && !turno().contexto) {
        banco.antes = null
        Object.assign(turno(), { status: 'incerto', rodando_desde: haMs(0) })
      }
    }
    await executarTurno(TURNO)
    expect(turno().contexto).toBeUndefined()
    expect(engineSendText).not.toHaveBeenCalled()
  })
})
