import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O cron dos robôs encerra a run do robô que deixou de estar ATIVO (adaptado
// do #674 do original) — a ponta de quem NÃO responde mais; a de quem responde
// é `dispatchInboundToFlows`. Sem ela, a run do robô pausado ficava "ativa"
// até o timeout da política, e a aba da conversa dizia que o robô seguia
// atendendo.
// ============================================================

type Linha = Record<string, unknown>

const h = vi.hoisted(() => ({
  runs: [] as Record<string, unknown>[],
  selects: [] as string[],
  /** O `gt('id', …)` de cada página lida (null = a primeira). */
  paginas: [] as (string | null)[],
  updates: [] as { payload: Record<string, unknown>; filtros: [string, unknown][] }[],
  eventos: [] as Record<string, unknown>[],
  erroAoEncerrar: false,
  erroNaLeitura: false,
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      if (tabela === 'flow_run_events') {
        return { insert: async (linha: Linha) => (h.eventos.push(linha), { error: null }) }
      }
      if (tabela !== 'flow_runs') throw new Error(`tabela inesperada: ${tabela}`)
      let update: { payload: Linha; filtros: [string, unknown][] } | null = null
      // A leitura POR CHAVE (porte #683): ordem por id, `gt` no último visto
      // e o limite da página, como o PostgREST.
      let depoisDe: string | null = null
      let limite = Infinity
      const b: Record<string, unknown> = {
        select: (colunas: string) => {
          if (!update) h.selects.push(colunas)
          return b
        },
        update: (payload: Linha) => {
          update = { payload, filtros: [] }
          h.updates.push(update)
          return b
        },
        eq: (k: string, v: unknown) => {
          update?.filtros.push([k, v])
          return b
        },
        order: () => b,
        gt: (_k: string, v: string) => ((depoisDe = v), b),
        limit: (n: number) => ((limite = n), b),
        then: (ok: (v: unknown) => unknown) => {
          if (!update) {
            h.paginas.push(depoisDe)
            if (h.erroNaLeitura) {
              return Promise.resolve({ data: null, error: { message: 'banco fora' } }).then(ok)
            }
            const pagina = h.runs
              .filter((r) => r.status === 'active')
              .sort((a, z) => (String(a.id) < String(z.id) ? -1 : 1))
              .filter((r) => depoisDe === null || String(r.id) > depoisDe)
              .slice(0, limite)
            return Promise.resolve({ data: pagina, error: null }).then(ok)
          }
          if (h.erroAoEncerrar && update.payload.status === 'stopped_by_agent') {
            return Promise.resolve({ data: null, error: { message: 'banco fora' } }).then(ok)
          }
          const { payload, filtros } = update
          const alvo = h.runs.filter((r) => filtros.every(([k, v]) => r[k] === v))
          for (const r of alvo) Object.assign(r, payload)
          return Promise.resolve({ data: alvo.map((r) => ({ id: r.id })), error: null }).then(ok)
        },
      }
      return b
    },
  }),
}))

import { GET } from './route'

const SEGREDO = 'segredo-do-cron'
const pedido = () => ({ headers: { get: () => SEGREDO } }) as unknown as Request
const HORA = 60 * 60 * 1000

const run = (id: string, robo: Linha | null, idadeHoras = 1): Linha => ({
  id,
  flow_id: `robo-${id}`,
  user_id: 'u1',
  contact_id: `c-${id}`,
  status: 'active',
  last_advanced_at: new Date(Date.now() - idadeHoras * HORA).toISOString(),
  flows: robo,
})

async function varrer() {
  const r = (await GET(pedido())) as Response
  return (await r.json()) as { swept: number; paradas: number }
}

const encerramentos = () => h.updates.filter((u) => u.payload.status === 'stopped_by_agent')

beforeEach(() => {
  vi.stubEnv('AUTOMATION_CRON_SECRET', SEGREDO)
  h.selects = []
  h.paginas = []
  h.updates = []
  h.eventos = []
  h.erroAoEncerrar = false
  h.erroNaLeitura = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('cron dos robôs — a run do robô que não está ativo', () => {
  it('lê o status do robô junto da política (um embutido só)', async () => {
    h.runs = []
    await varrer()
    expect(h.selects).toEqual([
      'id, flow_id, user_id, contact_id, last_advanced_at, flows ( fallback_policy, status )',
    ])
  })

  it('rascunho e arquivado: encerra como parada pela equipe, com motivo próprio — cercada pelo id e por active', async () => {
    h.runs = [
      run('pausado', { fallback_policy: {}, status: 'draft' }),
      run('arquivado', { fallback_policy: {}, status: 'archived' }),
      run('vivo', { fallback_policy: {}, status: 'active' }),
    ]

    const r = await varrer()

    expect(r).toEqual({ swept: 0, paradas: 2 })
    // Na ordem da chave (id): a leitura é por chave desde o porte #683.
    expect(encerramentos().map((u) => u.filtros)).toEqual([
      [
        ['id', 'arquivado'],
        ['status', 'active'],
      ],
      [
        ['id', 'pausado'],
        ['status', 'active'],
      ],
    ])
    expect(encerramentos()[0].payload).toMatchObject({ end_reason: 'robo_desativado', ended_at: expect.any(String) })
    expect(h.runs.find((x) => x.id === 'vivo')?.status).toBe('active')
    // Não é timeout: nenhum evento de timeout para quem foi encerrado.
    expect(h.eventos).toEqual([])
  })

  it('o robô pausado vence o timeout (a run velha dele é parada, não "expirada")', async () => {
    h.runs = [run('velho', { fallback_policy: { on_timeout_hours: 24 }, status: 'draft' }, 72)]

    expect(await varrer()).toEqual({ swept: 0, paradas: 1 })
    expect(h.runs[0]).toMatchObject({ status: 'stopped_by_agent', end_reason: 'robo_desativado' })
  })

  it('robô ATIVO segue a régua de sempre: só o velho expira, com o evento de timeout', async () => {
    h.runs = [
      run('novo', { fallback_policy: { on_timeout_hours: 24 }, status: 'active' }, 1),
      run('velho', { fallback_policy: { on_timeout_hours: 24 }, status: 'active' }, 30),
    ]

    expect(await varrer()).toEqual({ swept: 1, paradas: 0 })
    expect(h.runs.find((x) => x.id === 'velho')).toMatchObject({ status: 'timed_out', end_reason: 'stale_sweep' })
    expect(h.runs.find((x) => x.id === 'novo')?.status).toBe('active')
    expect(h.eventos).toHaveLength(1)
    expect(encerramentos()).toEqual([])
  })

  it('status do robô ausente é "não sei": nada é encerrado por isso', async () => {
    h.runs = [run('sem-status', { fallback_policy: {} }), run('sem-robo', null)]

    expect(await varrer()).toEqual({ swept: 0, paradas: 0 })
    expect(encerramentos()).toEqual([])
  })

  it('encerramento que falha não derruba a varredura: registra e segue para as outras', async () => {
    h.erroAoEncerrar = true
    h.runs = [
      run('pausado', { fallback_policy: {}, status: 'draft' }),
      run('velho', { fallback_policy: { on_timeout_hours: 24 }, status: 'active' }, 30),
    ]

    expect(await varrer()).toEqual({ swept: 1, paradas: 0 })
    expect(h.runs.find((x) => x.id === 'pausado')?.status).toBe('active')
  })
})

describe('cron dos robôs — leitura POR CHAVE (porte #683)', () => {
  it('⚠️ passa de 1.000 execuções ativas: lê todas, página por página, e varre todas', async () => {
    // Sem paginar, o PostgREST cortava em 1.000 e a 1.001ª nunca vencia.
    h.runs = Array.from({ length: 1500 }, (_, i) =>
      run(`r${String(i).padStart(4, '0')}`, { fallback_policy: { on_timeout_hours: 24 }, status: 'active' }, 30),
    )

    expect(await varrer()).toEqual({ swept: 1500, paradas: 0 })
    // Duas páginas: a primeira sem chave, a segunda depois da 1.000ª.
    expect(h.paginas).toEqual([null, 'r0999'])
    expect(h.runs.every((r) => r.status === 'timed_out')).toBe(true)
  })

  it('a leitura que falha é 500 e nada é varrido (nunca a lista pela metade)', async () => {
    h.erroNaLeitura = true
    h.runs = [run('velho', { fallback_policy: { on_timeout_hours: 24 }, status: 'active' }, 30)]

    const r = (await GET(pedido())) as Response
    expect(r.status).toBe(500)
    expect(h.updates).toEqual([])
  })
})
