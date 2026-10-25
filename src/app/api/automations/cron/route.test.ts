import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ============================================================
// A REDE dos turnos do agente de IA no laço rápido do agendador (F2 do
// docs/PLANO-agentes-de-ia.md, 5.7). O que se cobra aqui é o LUGAR: logo
// depois da autenticação e ANTES de qualquer `return` — o caminho comum da
// rota sai cedo ("não havia execução parada"), e uma rede posta no fim nunca
// rodaria. E em `after()`: a rede não segura a resposta ao `curl`.
// ============================================================

const h = vi.hoisted(() => ({
  ordem: [] as string[],
  afters: [] as unknown[],
  pendentes: { data: [] as unknown[], error: null as { message: string } | null },
  rede: vi.fn(),
  recolher: vi.fn(),
  retomar: vi.fn(),
  /** Os UPDATEs da reivindicação: o que gravam e com que cerca. */
  reivindicacoes: [] as { payload: Record<string, unknown>; filtros: [string, unknown][] }[],
  erroNaReivindicacao: null as { message: string } | null,
}))

vi.mock('next/server', () => ({
  after: (tarefa: unknown) => {
    h.ordem.push('after')
    h.afters.push(tarefa)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}))
vi.mock('@/lib/ia-agentes/rede', () => ({ rodarRedeDosTurnos: h.rede }))
vi.mock('@/lib/automations/drain-events', () => ({
  drenarEventosDeFunil: vi.fn(async () => {
    h.ordem.push('funil')
    return {}
  }),
  podarEventosAntigos: vi.fn(async () => 0),
}))
vi.mock('@/lib/webhooks/reentregar-eventos-de-funil', () => ({
  reentregarEventosDeFunil: vi.fn(async () => ({})),
}))
vi.mock('@/lib/automations/varrer-lembretes', () => ({
  varrerLembretes: vi.fn(async () => ({})),
  podarLembretesAntigos: vi.fn(async () => 0),
}))
vi.mock('@/lib/automations/engine', () => ({
  resumePendingExecution: h.retomar,
  recolherEsperasPresas: h.recolher,
}))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela === 'cb_agendador_batimento') {
        return { update: () => ({ eq: async () => ({ error: null }) }) }
      }
      if (tabela === 'automation_pending_executions') {
        let reivindicacao: { payload: Record<string, unknown>; filtros: [string, unknown][] } | null = null
        const cadeia = {
          select: () => cadeia,
          update: (payload: Record<string, unknown>) => {
            reivindicacao = { payload, filtros: [] }
            h.reivindicacoes.push(reivindicacao)
            return cadeia
          },
          eq: (k: string, v: unknown) => {
            reivindicacao?.filtros.push([k, v])
            return cadeia
          },
          lte: () => cadeia,
          order: () => cadeia,
          limit: async () => h.pendentes,
          maybeSingle: async () =>
            h.erroNaReivindicacao
              ? { data: null, error: h.erroNaReivindicacao }
              : { data: { id: reivindicacao?.filtros.find(([k]) => k === 'id')?.[1] }, error: null },
        }
        return cadeia
      }
      throw new Error(`tabela inesperada: ${tabela}`)
    },
  }),
}))

import { GET } from './route'

const SEGREDO = 'segredo-do-cron'

function pedido(segredo: string | null = SEGREDO): Request {
  return { headers: { get: () => segredo } } as unknown as Request
}

/** Uma promessa que nunca resolve: a rede "ainda rodando". */
const PARA_SEMPRE = new Promise<void>(() => {})

/** A outra rede, também "ainda rodando" — uma promessa própria, para o teste distinguir as duas. */
const RECOLHENDO = new Promise<number>(() => {})

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', SEGREDO)
  h.ordem = []
  h.afters = []
  h.pendentes = { data: [], error: null }
  h.reivindicacoes = []
  h.erroNaReivindicacao = null
  h.retomar.mockReset()
  h.rede.mockReset()
  h.rede.mockImplementation(() => {
    h.ordem.push('rede')
    return PARA_SEMPRE
  })
  h.recolher.mockReset()
  h.recolher.mockImplementation(() => {
    h.ordem.push('recolher')
    return RECOLHENDO
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cron das automações: a rede dos turnos do agente de IA', () => {
  it('no caminho comum (nada parado na fila), a rede é agendada — e ANTES do resto do ciclo', async () => {
    const r = (await GET(pedido())) as unknown as { status: number; body: { processed: number } }

    expect(r.status).toBe(200)
    expect(r.body.processed).toBe(0)
    expect(h.rede).toHaveBeenCalledTimes(1)
    // A promessa JÁ começada vai para o `after()` — a dos turnos e a do
    // recolhimento das esperas presas (1106)…
    expect(h.afters).toEqual([PARA_SEMPRE, RECOLHENDO])
    // …antes do dreno do funil, a primeira coisa do ciclo.
    expect(h.ordem).toEqual(['rede', 'after', 'recolher', 'after', 'funil'])
  })

  it('não segura a resposta: a rede ainda rodando, o GET já respondeu', async () => {
    // `PARA_SEMPRE` nunca resolve; se a rota a aguardasse, isto travaria.
    const r = (await GET(pedido())) as unknown as { status: number }
    expect(r.status).toBe(200)
  })

  it('a leitura da fila que FALHA (o outro `return` antecipado) não impede a rede', async () => {
    h.pendentes = { data: [], error: { message: 'banco fora' } }

    const r = (await GET(pedido())) as unknown as { status: number }

    expect(r.status).toBe(500)
    expect(h.rede).toHaveBeenCalledTimes(1)
    expect(h.recolher).toHaveBeenCalledTimes(1)
  })

  it('sem o segredo certo, nada roda — nem a rede', async () => {
    const r = (await GET(pedido('errado'))) as unknown as { status: number }

    expect(r.status).toBe(401)
    expect(h.rede).not.toHaveBeenCalled()
    expect(h.recolher).not.toHaveBeenCalled()
    expect(h.afters).toEqual([])
  })

  it('cron sem segredo configurado: 503, e nada roda', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')

    const r = (await GET(pedido())) as unknown as { status: number }

    expect(r.status).toBe(503)
    expect(h.rede).not.toHaveBeenCalled()
  })
})

describe('a reivindicação carimba claimed_at (1106)', () => {
  const vencida = {
    id: 'esp-1',
    automation_id: 'auto-1',
    account_id: 'acct-1',
    user_id: 'u-1',
    contact_id: 'c-1',
    log_id: 'log-1',
    parent_step_id: null,
    branch: null,
    next_step_position: 2,
    context: {},
    created_at: '2026-10-25T10:00:00.000Z',
  }

  it('grava status running E o carimbo, cercada por `pending`, e só então retoma', async () => {
    h.pendentes = { data: [vencida], error: null }
    const antes = Date.now()

    const r = (await GET(pedido())) as unknown as { body: { processed: number } }

    expect(h.reivindicacoes).toHaveLength(1)
    const { payload, filtros } = h.reivindicacoes[0]
    expect(payload.status).toBe('running')
    // O relógio do recolhimento: sem ele, a presa só seria vista 24 h depois.
    expect(typeof payload.claimed_at).toBe('string')
    expect(Date.parse(payload.claimed_at as string)).toBeGreaterThanOrEqual(antes - 1000)
    expect(Date.parse(payload.claimed_at as string)).toBeLessThanOrEqual(Date.now() + 1000)
    expect(filtros).toEqual([
      ['id', 'esp-1'],
      ['status', 'pending'],
    ])
    expect(h.retomar).toHaveBeenCalledTimes(1)
    expect(h.retomar).toHaveBeenCalledWith(expect.objectContaining({ id: 'esp-1', log_id: 'log-1' }))
    expect(r.body.processed).toBe(1)
  })

  it('reivindicação que FALHA (a 1106 não aplicada) não retoma — e diz por quê no log', async () => {
    h.pendentes = { data: [vencida], error: null }
    h.erroNaReivindicacao = { message: "Could not find the 'claimed_at' column" }
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = (await GET(pedido())) as unknown as { body: { processed: number } }

    expect(h.retomar).not.toHaveBeenCalled()
    expect(r.body.processed).toBe(0)
    expect(erro).toHaveBeenCalledWith(
      '[automations] reivindicar a espera falhou:',
      'esp-1',
      "Could not find the 'claimed_at' column"
    )
    erro.mockRestore()
  })
})

describe('o LUGAR da rede no fonte', () => {
  // O teste de comportamento acima só percorre os `return` que existem hoje;
  // o de fonte pega o `return` NOVO posto entre a autenticação e a rede.
  const fonte = fs
    .readFileSync(path.join(__dirname, 'route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('só as duas saídas da autenticação vêm antes de `after(rodarRedeDosTurnos())`', () => {
    const rede = fonte.indexOf('after(rodarRedeDosTurnos())')
    expect(rede).toBeGreaterThan(-1)
    const antes = fonte.slice(0, rede)
    expect(antes.match(/\breturn\b/g) ?? []).toHaveLength(2)
    expect(antes).toContain("'cron not configured'")
    expect(antes).toContain("'Unauthorized'")
  })

  it('o recolhimento das esperas presas (1106) também vem antes de todo `return` do ciclo', () => {
    const recolher = fonte.indexOf('after(recolherEsperasPresas())')
    expect(recolher).toBeGreaterThan(fonte.indexOf('after(rodarRedeDosTurnos())'))
    expect(fonte.slice(0, recolher).match(/\breturn\b/g) ?? []).toHaveLength(2)
    // E ANTES do dreno, que é `await` e pode demorar o ciclo inteiro.
    expect(recolher).toBeLessThan(fonte.indexOf('await drenarEventosDeFunil()'))
  })
})
