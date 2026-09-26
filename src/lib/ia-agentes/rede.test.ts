import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A REDE dos turnos (`rede.ts`), no laço rápido do agendador. Duas tarefas:
//  1. RECOLHER o `rodando` órfão SEM re-executar — ele pode já ter mandado a
//     resposta. Decide pelo que o turno carimbou: sem `enviando_desde` →
//     `falhou` (nada saiu, não transfere); com `enviando_desde` e sem id →
//     `incerto` e vai para gente; com o id → `respondeu`. A escrita tem a
//     cerca do MESMO `rodando_desde` lido.
//  2. RODAR os pendentes vencidos que o disparo imediato não rodou.
// O turno em si é dublê (tem teste próprio, `turno.test.ts`).
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
vi.mock('./repo', () => ({ obterAgente: vi.fn() }))
vi.mock('./turno', () => ({ executarTurno: vi.fn(async () => {}), transferirParaGente: vi.fn(async () => {}) }))

import type { IaAgente } from './agente'
import { RECOLHER_TURNO_MS, TURNOS_POR_TIQUE } from './fila'
import { rodarRedeDosTurnos } from './rede'
import { obterAgente } from './repo'
import { executarTurno, transferirParaGente } from './turno'

// ------------------------------------------------------------
// O cenário
// ------------------------------------------------------------

const CONTA = 'conta-1'
const haMs = (ms: number) => new Date(Date.now() - ms).toISOString()
const daquiMs = (ms: number) => new Date(Date.now() + ms).toISOString()
const VELHO = () => haMs(RECOLHER_TURNO_MS + 60_000)

function orfao(p: Linha = {}): Linha {
  return {
    id: 'turno-orfao',
    account_id: CONTA,
    conversation_id: 'conv-1',
    ia_agente_id: 'ag-1',
    status: 'rodando',
    rodando_desde: VELHO(),
    enviando_desde: null,
    mensagem_enviada_id: null,
    erro: null,
    terminado_em: null,
    executar_apos: haMs(RECOLHER_TURNO_MS + 70_000),
    ...p,
  }
}

const linha = (id: string) => banco.tabelas.cb_ia_turnos.find((t) => t.id === id) as Linha

beforeEach(() => {
  banco = criarBanco()
  banco.tabelas.cb_ia_turnos = []
  banco.tabelas.conversations = [{ id: 'conv-1', account_id: CONTA, contact_id: 'contato-1' }]
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(obterAgente)
    .mockReset()
    .mockResolvedValue({ id: 'ag-1', nome: 'Triagem', transferirPara: 'membro-1' } as IaAgente)
})

// ------------------------------------------------------------
// O recolhedor
// ------------------------------------------------------------

describe('rodarRedeDosTurnos — o órfão', () => {
  it('sem `enviando_desde`: morreu antes de enviar → `falhou`, sem transferir', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao())
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao')).toMatchObject({
      status: 'falhou',
      erro: 'recolhido: o processo parou antes de enviar',
    })
    expect(linha('turno-orfao').terminado_em).toEqual(expect.any(String))
    expect(transferirParaGente).not.toHaveBeenCalled()
    // O recolhedor NUNCA re-executa: re-executar mandaria a resposta de novo.
    expect(executarTurno).not.toHaveBeenCalled()
  })

  it('com `enviando_desde` e sem o id: pode ter saído → `incerto` e vai para gente', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ enviando_desde: haMs(RECOLHER_TURNO_MS) }))
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao').status).toBe('incerto')
    expect(transferirParaGente).toHaveBeenCalledWith(banco, {
      accountId: CONTA,
      conversationId: 'conv-1',
      contactId: 'contato-1',
      nomeDoAgente: 'Triagem',
      transferirPara: 'membro-1',
      motivo: 'incerto',
    })
    expect(executarTurno).not.toHaveBeenCalled()
  })

  it('incerto com o agente ilegível: transfere assim mesmo, com nome genérico e sem destino', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ enviando_desde: haMs(RECOLHER_TURNO_MS) }))
    vi.mocked(obterAgente).mockRejectedValue(new Error('rede'))
    await rodarRedeDosTurnos()
    expect(transferirParaGente).toHaveBeenCalledWith(
      banco,
      expect.objectContaining({ nomeDoAgente: 'IA', transferirPara: null, motivo: 'incerto' }),
    )
  })

  it('incerto de turno sem agente (apagado): recolhe, sem transferir', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ enviando_desde: haMs(RECOLHER_TURNO_MS), ia_agente_id: null }))
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao').status).toBe('incerto')
    expect(transferirParaGente).not.toHaveBeenCalled()
  })

  it('com o id do provedor: saiu → `respondeu`, com o erro, sem transferir', async () => {
    banco.tabelas.cb_ia_turnos.push(
      orfao({ enviando_desde: haMs(RECOLHER_TURNO_MS), mensagem_enviada_id: 'wamid.resposta' }),
    )
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao')).toMatchObject({
      status: 'respondeu',
      mensagem_enviada_id: 'wamid.resposta',
      erro: 'recolhido depois de enviar (o processo parou antes de registrar)',
    })
    expect(transferirParaGente).not.toHaveBeenCalled()
  })

  it('`rodando` recente (dentro do prazo) não é tocado', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ rodando_desde: haMs(10_000), enviando_desde: haMs(5_000) }))
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao').status).toBe('rodando')
    expect(transferirParaGente).not.toHaveBeenCalled()
  })

  it('a cerca: se a posse mudou entre a leitura e a escrita (0 linhas), nada muda e ninguém transfere', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ enviando_desde: haMs(RECOLHER_TURNO_MS) }))
    const novaPosse = new Date().toISOString()
    banco.antes = (tabela, op) => {
      // Outro recolhedor (ou o turno reivindicado de novo) chegou antes.
      if (tabela === 'cb_ia_turnos' && op === 'update') linha('turno-orfao').rodando_desde = novaPosse
    }
    await rodarRedeDosTurnos()
    expect(linha('turno-orfao')).toMatchObject({ status: 'rodando', rodando_desde: novaPosse, terminado_em: null })
    expect(transferirParaGente).not.toHaveBeenCalled()
  })

  it('erro ao recolher um órfão não impede os seguintes', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ id: 'o1' }), orfao({ id: 'o2', rodando_desde: haMs(RECOLHER_TURNO_MS + 30_000) }))
    banco.falhas.push({ tabela: 'cb_ia_turnos', op: 'update', erro: { message: 'falhou' } })
    await rodarRedeDosTurnos()
    const status = ['o1', 'o2'].map((id) => linha(id).status).sort()
    expect(status).toEqual(['falhou', 'rodando'])
  })
})

// ------------------------------------------------------------
// Os pendentes vencidos
// ------------------------------------------------------------

describe('rodarRedeDosTurnos — os vencidos', () => {
  function pendente(id: string, executarApos: string, conversa = `conv-${id}`): Linha {
    return { id, account_id: CONTA, conversation_id: conversa, status: 'aguardando', executar_apos: executarApos }
  }

  it('roda os vencidos, do mais antigo ao mais novo, e deixa os da rajada em curso', async () => {
    banco.tabelas.cb_ia_turnos.push(
      pendente('b', haMs(1_000)),
      pendente('a', haMs(60_000)),
      pendente('futuro', daquiMs(5_000)),
      { ...pendente('terminado', haMs(60_000)), status: 'respondeu' },
    )
    await rodarRedeDosTurnos()
    expect(vi.mocked(executarTurno).mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it(`no máximo ${TURNOS_POR_TIQUE} por tique`, async () => {
    for (let i = 0; i < TURNOS_POR_TIQUE + 3; i++) banco.tabelas.cb_ia_turnos.push(pendente(`t${i}`, haMs(1_000 + i)))
    await rodarRedeDosTurnos()
    expect(executarTurno).toHaveBeenCalledTimes(TURNOS_POR_TIQUE)
  })

  it('primeiro recolhe, depois roda (o órfão não segura a conversa)', async () => {
    banco.tabelas.cb_ia_turnos.push(orfao({ conversation_id: 'conv-1' }), pendente('p1', haMs(1_000), 'conv-1'))
    let statusDoOrfaoAoRodar: unknown = null
    vi.mocked(executarTurno).mockImplementation(async () => {
      statusDoOrfaoAoRodar = linha('turno-orfao').status
    })
    await rodarRedeDosTurnos()
    expect(executarTurno).toHaveBeenCalledWith('p1')
    expect(statusDoOrfaoAoRodar).toBe('falhou')
  })

  it('leitura dos vencidos que falha: não lança', async () => {
    banco.tabelas.cb_ia_turnos.push(pendente('a', haMs(1_000)))
    // A 1ª leitura (os órfãos) passa; a 2ª (os vencidos) falha.
    banco.antes = (tabela, op) => {
      if (tabela === 'cb_ia_turnos' && op === 'select' && banco.chamadas.some((c) => c.tabela === 'cb_ia_turnos')) {
        banco.falhas.push({ tabela, op, erro: { message: 'timeout' } })
      }
    }
    await expect(rodarRedeDosTurnos()).resolves.toBeUndefined()
    expect(executarTurno).not.toHaveBeenCalled()
  })
})
