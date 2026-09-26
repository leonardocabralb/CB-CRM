import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O TURNO do agente de IA (`turno.ts`, docs/PLANO-agentes-de-ia.md 5.7 e
// E5–E10). O banco é FALSO, em memória, e imita do PostgREST só o que o turno
// usa (filtros, `update … select`, `maybeSingle`, as RPCs da 1044). Provedor
// de IA, envio, transcrição e chave são dublês; o resto (contexto, pedido,
// horário, textos da transferência, `donoDaConta`) roda de verdade.
//
// ⚠️ O que estes testes seguram, e por quê:
//  - NUNCA reenviar: o que falha no meio do envio vira `incerto` e vai para
//    gente; só a recusa COMPROVADA (4xx) ou o erro antes do provedor é
//    `falhou`.
//  - Falha de CONFIGURAÇÃO não transfere (E8): a pausa 'transferencia' é
//    permanente, o problema é passageiro.
//  - A cerca de posse: turno recolhido por outro processo não envia.
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
vi.mock('@/lib/ai/digitando', () => ({ mostrarDigitando: vi.fn(async () => 'pulado') }))
vi.mock('@/lib/ia-chaves/repo', () => ({ lerChave: vi.fn() }))
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

import type { IaAgente } from './agente'
import { JANELA_DO_AUDIO_MS } from './fila'
import { obterAgente } from './repo'
import { executarTurno, nadaSaiu, transferirParaGente } from './turno'

// ------------------------------------------------------------
// O cenário
// ------------------------------------------------------------

const CONTA = 'conta-1'
const CONVERSA = 'conv-1'
const CANAL = 'canal-1'
const OUTRO_CANAL = 'canal-2'
const AGENTE = 'ag-1'
const MEMBRO = 'membro-1'
const TURNO = 'turno-1'
const GATILHO = 'msg-1'

const haMs = (ms: number) => new Date(Date.now() - ms).toISOString()
const daquiMs = (ms: number) => new Date(Date.now() + ms).toISOString()

function agente(p: Partial<IaAgente> = {}): IaAgente {
  return {
    id: AGENTE,
    accountId: CONTA,
    nome: 'Triagem',
    descricao: '',
    instrucoes: 'Seja breve.',
    regras: [],
    provedor: 'gemini',
    modelo: 'gemini-teste',
    ativo: true,
    conexoes: [CANAL],
    horario: null,
    tetoRespostas: 10,
    podePassarPara: [],
    transferirPara: MEMBRO,
    arquivadoEm: null,
    createdAt: '',
    updatedAt: '',
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
    message_id: 'wamid.cliente',
    gravada_em: haMs(20_000),
    created_at: haMs(20_000),
    deleted_at: null,
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
      ia_agente_id: AGENTE,
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      assigned_agent_id: null,
      ia_pausada_por: null,
      ia_pausada_em: null,
    },
  ]
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
  // A 1044: reivindica o pendente VENCIDO, e nunca com outro `rodando` na
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
  // O teto conferido e consumido num UPDATE só.
  banco.rpcs.claim_ai_reply_slot = ({ conversation_id, max_replies }) => {
    const c = banco.tabelas.conversations.find((x) => x.id === conversation_id)
    if (!c || (c.ai_reply_count as number) >= (max_replies as number)) return { data: false, error: null }
    c.ai_reply_count = (c.ai_reply_count as number) + 1
    return { data: true, error: null }
  }
}

const turno = () => banco.tabelas.cb_ia_turnos.find((t) => t.id === TURNO) as Linha
const conversa = () => banco.tabelas.conversations[0]
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
  vi.mocked(obterAgente).mockReset().mockResolvedValue(agente())
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
})

/** O envio falha DEPOIS de chamar o provedor (o erro vem dele). */
function envioFalhaNoProvedor(err: unknown): void {
  vi.mocked(engineSendText).mockImplementation(async (args) => {
    args.antesDoProvedor?.()
    throw err
  })
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
    banco.tabelas.messages.push(mensagem({ id: 'msg-2', channel_id: OUTRO_CANAL, message_id: 'wamid.2' }))
    banco.tabelas.cb_ia_turnos.push({
      ...turno(),
      id: 'turno-2',
      canal_id: OUTRO_CANAL,
      mensagem_gatilho_id: 'msg-2',
      mensagem_inicial_id: 'msg-2',
    })
    vi.mocked(obterAgente).mockResolvedValue(agente({ conexoes: [CANAL, OUTRO_CANAL] }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(banco.tabelas.cb_ia_turnos.find((t) => t.id === 'turno-2')?.status).toBe('respondeu')
    expect(engineSendText).toHaveBeenCalledTimes(2)
  })
})

// ------------------------------------------------------------
// As conferências: descartar
// ------------------------------------------------------------

describe('executarTurno — descarta', () => {
  it('turno sem agente', async () => {
    turno().ia_agente_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o agente da conversa mudou' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('o agente da conversa trocou', async () => {
    conversa().ia_agente_id = 'ag-2'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o agente da conversa mudou' })
  })

  it.each([
    ['sumiu', null],
    ['desligado', agente({ ativo: false })],
    ['arquivado', agente({ arquivadoEm: haMs(1_000) })],
    ['sem esta conexão', agente({ conexoes: [OUTRO_CANAL] })],
  ])('o agente %s', async (_rotulo, lido) => {
    vi.mocked(obterAgente).mockResolvedValue(lido)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'agente indisponível nesta conexão' })
    expect(generateReply).not.toHaveBeenCalled()
  })

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
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'conversa' })
  })

  it('conversa ENCERRADA (uma automação a fechou na rajada)', async () => {
    conversa().status = 'closed'
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'conversa encerrada' })
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('a mensagem que abriu o turno foi apagada', async () => {
    banco.tabelas.messages[0].deleted_at = haMs(1_000)
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'a mensagem sumiu ou foi apagada' })
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

  // A MESMA régua do portão da entrada (`abreTurno`), sobre a linha GRAVADA:
  // só descarta a mensagem que abriu o turno substituto. As formas são as que
  // as ingestões gravam (a figurinha é `image` com `image/webp`; cartão de
  // contato, enquete e botão da Evolution são `text` sem texto).
  it.each<[string, Linha]>([
    ['figurinha', { content_type: 'image', content_text: null, media_type: 'image/webp' }],
    ['cartão de contato / enquete (texto nulo)', { content_type: 'text', content_text: null }],
    ['texto sem nada visível', { content_type: 'text', content_text: ' \n\uFFFC ' }],
    ['localização', { content_type: 'location', content_text: 'Rua X' }],
    ['toque em botão (Meta)', { content_type: 'interactive', content_text: 'Sim' }],
    ['texto APAGADO', { content_text: 'deixa pra lá', deleted_at: haMs(1_000) }],
  ])('mensagem mais nova que não abre turno NÃO descarta: %s', async (_rotulo, p) => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: haMs(5_000), message_id: 'wamid.nova', ...p }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it.each([
    ['foto (image/jpeg)', 'image/jpeg'],
    ['foto ainda sem MIME (a Evolution o grava no download)', null],
  ])('%s mais nova DESCARTA', async (_rotulo, mime) => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-foto', content_type: 'image', content_text: null, media_type: mime, gravada_em: haMs(5_000) }),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
  })

  it('a figurinha no meio da rajada não esconde o texto que veio depois dela', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-fig', content_type: 'image', content_text: null, media_type: 'image/webp', gravada_em: haMs(6_000) }),
      mensagem({ id: 'msg-txt', content_text: 'e aí?', gravada_em: haMs(5_000) }),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
  })

  it('o cliente escreve ENQUANTO o modelo pensa: descarta antes de enviar, sem gastar vaga', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages.push(mensagem({ id: 'msg-nova', gravada_em: new Date().toISOString() }))
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'mensagem mais nova do cliente' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ai_reply_count).toBe(0)
  })

  it('o advogado responde ENQUANTO o modelo pensa: pausado_no_meio, sem enviar', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente' })
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno().status).toBe('pausado_no_meio')
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ia_pausada_por).toBe('gente')
  })

  it('a equipe respondeu DEPOIS da mensagem (a corrida da entrada): pausa por gente, sem gerar', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-adv', sender_type: 'agent', from_device: true, gravada_em: haMs(10_000) }),
    )
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'pausado_no_meio', erro: 'a equipe respondeu' })
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'gente' })
    expect(generateReply).not.toHaveBeenCalled()
    expect(notas()).toHaveLength(0)
  })

  it('resposta da equipe APAGADA não segura o turno (o critério do Radar)', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-adv', sender_type: 'agent', from_device: true, gravada_em: haMs(10_000), deleted_at: haMs(8_000) }),
    )
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('resposta da equipe ANTES da mensagem do cliente não segura o turno', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-adv', sender_type: 'agent', sender_id: 'advogado-1', gravada_em: haMs(60_000) }),
    )
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('a resposta do PRÓPRIO agente não conta como gente', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-ia', sender_type: 'agent', from_device: true, ia_agente_id: AGENTE, gravada_em: haMs(10_000) }),
    )
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  // O robô ou uma automação respondeu DEPOIS da mensagem (Codex, #292): o
  // cliente toca num botão na rajada, a automação de `button_response`
  // responde, e o turno do texto não pode responder de novo.
  it('o robô ou uma automação respondeu depois da mensagem: descarta, sem gerar', async () => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-automacao', sender_type: 'bot', gravada_em: haMs(9_000) }))
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('a automação responde ENQUANTO o modelo pensa: descarta antes de enviar, sem gastar vaga', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages.push(mensagem({ id: 'msg-automacao', sender_type: 'bot', gravada_em: new Date().toISOString() }))
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'o robô ou uma automação respondeu' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ai_reply_count).toBe(0)
  })

  it('a automação respondeu por OUTRA conexão: não derruba o turno desta (D4)', async () => {
    banco.tabelas.messages.push(
      mensagem({ id: 'msg-automacao', sender_type: 'bot', channel_id: OUTRO_CANAL, gravada_em: haMs(9_000) }),
    )
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it.each<[string, Linha]>([
    ['a saída do PRÓPRIO agente (bot com ia_agente_id)', { sender_type: 'bot', ia_agente_id: AGENTE, gravada_em: haMs(9_000) }],
    ['saída do robô APAGADA', { sender_type: 'bot', gravada_em: haMs(9_000), deleted_at: haMs(5_000) }],
    ['saída do robô ANTES da mensagem do cliente', { sender_type: 'bot', gravada_em: haMs(60_000) }],
  ])('%s não descarta', async (_rotulo, p) => {
    banco.tabelas.messages.push(mensagem({ id: 'msg-saida', ...p }))
    await executarTurno(TURNO)
    expect(turno().status).toBe('respondeu')
  })

  it('a equipe responde ENQUANTO o modelo pensa: não envia', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      banco.tabelas.messages.push(
        mensagem({ id: 'msg-adv', sender_type: 'agent', sender_id: 'advogado-1', gravada_em: new Date().toISOString() }),
      )
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'pausado_no_meio', erro: 'a equipe respondeu' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ai_reply_count).toBe(0)
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
    vi.mocked(obterAgente).mockResolvedValue(
      agente({ horario: { dias: [(dia + 1) % 7], inicio: '00:00', fim: '23:59' } }),
    )
    await executarTurno(TURNO)
    expect(turno().status).toBe('fora_do_horario')
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa().ai_autoreply_disabled).toBe(false)
  })

  it('teto de respostas atingido: transfere (`teto`) sem gerar', async () => {
    conversa().ai_reply_count = 10
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'teto' })
    expect(generateReply).not.toHaveBeenCalled()
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia' })
    expect(notas()).toHaveLength(1)
  })

  it('o teto estourou entre a leitura e a vaga (corrida): transfere sem enviar', async () => {
    banco.rpcs.claim_ai_reply_slot = () => ({ data: false, error: null })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'teto' })
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
// A transferência para gente
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
    // Nada sai para o cliente (E7), e a vaga do teto não é gasta.
    expect(engineSendText).not.toHaveBeenCalled()
    expect(conversa().ai_reply_count).toBe(0)
  })

  it('resposta vazia também transfere', async () => {
    vi.mocked(generateReply).mockResolvedValue({ text: '   ', handoff: false, usage: null })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'transferiu', erro: 'sentinela' })
  })

  it('o advogado respondeu ENQUANTO o modelo pensava e o modelo pediu transferência: a pausa de gente fica', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      // O gatilho da 1044 pausou por gente (a resposta do celular).
      Object.assign(conversa(), { ai_autoreply_disabled: true, ia_pausada_por: 'gente', ia_pausada_em: haMs(1_000) })
      return { text: '', handoff: true, usage: null }
    })
    await executarTurno(TURNO)
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'gente', assigned_agent_id: null })
    expect(notas()).toHaveLength(0)
    // O registro diz que ninguém transferiu: a conversa já era de gente.
    expect(turno().status).toBe('pausado_no_meio')
    expect(String(turno().erro)).toContain('não transferiu (sentinela)')
    expect(turno().terminado_em).toEqual(expect.any(String))
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
    vi.mocked(obterAgente).mockResolvedValue(agente({ transferirPara: null }))
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

describe('transferirParaGente — cercada pelo agente', () => {
  const args = {
    accountId: CONTA,
    conversationId: CONVERSA,
    contactId: 'contato-1',
    iaAgenteId: AGENTE,
    nomeDoAgente: 'Triagem',
    transferirPara: MEMBRO,
    motivo: 'sentinela' as const,
  }

  it('a conversa já é de OUTRO agente: nada muda', async () => {
    conversa().ia_agente_id = 'ag-2'
    await transferirParaGente(banco as never, args)
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: false, ia_pausada_por: null, assigned_agent_id: null })
    expect(notas()).toHaveLength(0)
  })

  it('a conversa de OUTRA conta: nada muda', async () => {
    await transferirParaGente(banco as never, { ...args, accountId: 'outra-conta' })
    expect(conversa().ai_autoreply_disabled).toBe(false)
    expect(notas()).toHaveLength(0)
  })

  it('erro ao pausar: nada mais é escrito, e não lança', async () => {
    banco.falhas.push({ tabela: 'conversations', op: 'update', erro: { message: 'falhou' } })
    await expect(transferirParaGente(banco as never, args)).resolves.toBe('falhou')
    expect(notas()).toHaveLength(0)
  })

  it('pausa, atribui e anota: `transferiu`', async () => {
    await expect(transferirParaGente(banco as never, args)).resolves.toBe('transferiu')
    expect(conversa()).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'transferencia', assigned_agent_id: MEMBRO })
    expect(notas()).toHaveLength(1)
  })

  it.each(['gente', 'botao', 'transferencia'])(
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
    expect(conversa().ai_reply_count).toBe(1)
    expect(notas()).toHaveLength(0)
    expect(mostrarDigitando).toHaveBeenCalledWith(
      banco,
      expect.objectContaining({ channelId: CANAL, inboundMessageId: 'wamid.cliente' }),
    )
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

  it('recusa comprovada da Evolution (4xx): falhou, sem transferir', async () => {
    envioFalhaNoProvedor(new EvolutionApiError('número inválido', 400))
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(String(turno().erro)).toContain('envio recusado')
    expect(conversa().ai_autoreply_disabled).toBe(false)
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

  it('erro ANTES do provedor (contato, conversa, alvo): falhou, sem transferir', async () => {
    vi.mocked(engineSendText).mockRejectedValue(new Error('contact not found for this account'))
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(notas()).toHaveLength(0)
  })

  it('canal exigido indisponível: falhou, sem transferir', async () => {
    vi.mocked(engineSendText).mockRejectedValue(new CanalExigidoIndisponivelError())
    await executarTurno(TURNO)
    expect(turno().status).toBe('falhou')
    expect(notas()).toHaveLength(0)
  })

  it('saiu e o registro falhou: respondeu, com o erro — nunca reenvia', async () => {
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      await args.aoSair?.('wamid.saiu')
      throw new EnviadaSemRegistroError('wamid.saiu', 'insert timeout')
    })
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'respondeu', mensagem_enviada_id: 'wamid.saiu' })
    expect(String(turno().erro)).toContain('insert timeout')
    expect(notas()).toHaveLength(0)
    expect(engineSendText).toHaveBeenCalledTimes(1)
  })

  it('perda da posse (o recolhedor tomou a linha): não envia nem escreve por cima', async () => {
    vi.mocked(generateReply).mockImplementation(async () => {
      // Outro processo recolheu o turno enquanto o modelo pensava.
      Object.assign(turno(), { status: 'falhou', rodando_desde: '1999-01-01T00:00:00.000Z', erro: 'recolhido' })
      return { text: 'Olá!', handoff: false, usage: null }
    })
    await executarTurno(TURNO)
    expect(engineSendText).not.toHaveBeenCalled()
    expect(banco.rpcChamadas.some((c) => c.nome === 'claim_ai_reply_slot')).toBe(false)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'recolhido', enviando_desde: null })
    expect(notas()).toHaveLength(0)
  })

  it('a conta sem dono: falhou, sem enviar e SEM gastar a vaga do teto', async () => {
    banco.tabelas.accounts[0].owner_user_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'falhou', erro: 'a conta não tem dono' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(banco.rpcChamadas.some((c) => c.nome === 'claim_ai_reply_slot')).toBe(false)
    expect(conversa().ai_reply_count).toBe(0)
  })

  it('conversa sem contato: descartado, sem enviar e SEM gastar a vaga do teto', async () => {
    conversa().contact_id = null
    await executarTurno(TURNO)
    expect(turno()).toMatchObject({ status: 'descartado', erro: 'conversa sem contato' })
    expect(engineSendText).not.toHaveBeenCalled()
    expect(banco.rpcChamadas.some((c) => c.nome === 'claim_ai_reply_slot')).toBe(false)
    expect(conversa().ai_reply_count).toBe(0)
  })

  it('o recolhedor tomou o turno NO MEIO do envio: o id do provedor é gravado assim mesmo (o eco o lê), e o desfecho dele fica', async () => {
    vi.mocked(engineSendText).mockImplementation(async (args) => {
      args.antesDoProvedor?.()
      // Outro processo recolheu o turno enquanto o provedor respondia.
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
    // A rajada começou nele: sem `executar_apos` futuro, o turno está vencido.
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
