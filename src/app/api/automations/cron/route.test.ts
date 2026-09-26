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
vi.mock('@/lib/automations/engine', () => ({ resumePendingExecution: vi.fn() }))
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela === 'cb_agendador_batimento') {
        return { update: () => ({ eq: async () => ({ error: null }) }) }
      }
      if (tabela === 'automation_pending_executions') {
        const cadeia = {
          select: () => cadeia,
          eq: () => cadeia,
          lte: () => cadeia,
          order: () => cadeia,
          limit: async () => h.pendentes,
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

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', SEGREDO)
  h.ordem = []
  h.afters = []
  h.pendentes = { data: [], error: null }
  h.rede.mockReset()
  h.rede.mockImplementation(() => {
    h.ordem.push('rede')
    return PARA_SEMPRE
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
    // A promessa JÁ começada vai para o `after()`…
    expect(h.afters).toEqual([PARA_SEMPRE])
    // …antes do dreno do funil, a primeira coisa do ciclo.
    expect(h.ordem).toEqual(['rede', 'after', 'funil'])
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
  })

  it('sem o segredo certo, nada roda — nem a rede', async () => {
    const r = (await GET(pedido('errado'))) as unknown as { status: number }

    expect(r.status).toBe(401)
    expect(h.rede).not.toHaveBeenCalled()
    expect(h.afters).toEqual([])
  })

  it('cron sem segredo configurado: 503, e nada roda', async () => {
    vi.stubEnv('AUTOMATION_CRON_SECRET', '')

    const r = (await GET(pedido())) as unknown as { status: number }

    expect(r.status).toBe(503)
    expect(h.rede).not.toHaveBeenCalled()
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
})
