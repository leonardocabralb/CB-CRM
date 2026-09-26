import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/cb/ia/uso — a soma vem de uma RPC, e o PostgREST corta RPC em 1000
// linhas também (revisão da F1b): com a ordem por dia, quem sumia eram os dias
// MAIS RECENTES, e o total saía menor sem aviso. A rota pagina; não conseguindo
// ler tudo, falha em vez de somar pela metade.
// ============================================================

let cotacaoDaConta: string | null = '5.5'
const buscarPtax = vi.fn(async (): Promise<{ valor: number; dia: string } | null> => ({ valor: 5.2, dia: '2026-09-25' }))
let paginas: Array<{ data: unknown[] | null; error: { message: string } | null; count: number | null }> = []
const ranges: Array<[number, number]> = []

function linha(i: number) {
  return {
    dia: '2026-09-25',
    modo: 'radar',
    ia_agente_id: null,
    ia_agente_nome: null,
    provedor: 'gemini',
    modelo: `m-${i}`,
    chamadas: 1,
    tokens_entrada: 10,
    tokens_saida: 10,
    tokens_total: 20,
  }
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { adminAction: {} },
}))
vi.mock('@/lib/ia-agentes/repo', () => ({
  listarAgentes: vi.fn(async () => [
    { id: 'ag-1', nome: 'Triagem (nome novo)', arquivadoEm: null },
  ]),
}))
vi.mock('@/lib/ia-agentes/cotacao-automatica', async (original) => ({
  ...(await original<typeof import('@/lib/ia-agentes/cotacao-automatica')>()),
  buscarPtax: () => buscarPtax(),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => {
    const rpc = () => {
      const q = {
        order: () => q,
        range: async (de: number, ate: number) => {
          ranges.push([de, ate])
          return paginas.shift() ?? { data: [], error: null, count: 0 }
        },
      }
      return q
    }
    return {
      rpc,
      from: () => ({
        select: () => ({
          eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: { cotacao_dolar: cotacaoDaConta }, error: null }) }) }),
        }),
      }),
    }
  },
}))

import { GET } from './route'

beforeEach(() => {
  cotacaoDaConta = '5.5'
  buscarPtax.mockClear()
  paginas = []
  ranges.length = 0
})

describe('GET /api/cb/ia/uso — paginado', () => {
  it('soma TODAS as páginas (1000 + 500), não só a primeira', async () => {
    paginas = [
      { data: Array.from({ length: 1000 }, (_, i) => linha(i)), error: null, count: 1500 },
      { data: Array.from({ length: 500 }, (_, i) => linha(1000 + i)), error: null, count: 1500 },
    ]
    const res = await GET(new Request('http://x/api/cb/ia/uso?dias=30'))
    expect(res.status).toBe(200)
    const corpo = (await res.json()) as { resumo: { total: { chamadas: number } } }
    expect(corpo.resumo.total.chamadas).toBe(1500)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('erro numa página = 500, nunca o total da metade', async () => {
    paginas = [
      { data: Array.from({ length: 1000 }, (_, i) => linha(i)), error: null, count: 1500 },
      { data: null, error: { message: 'timeout' }, count: null },
    ]
    const res = await GET(new Request('http://x/api/cb/ia/uso?dias=30'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ code: 'banco' })
  })

  it('o agente aparece com o nome ATUAL, não o congelado no log', async () => {
    paginas = [
      {
        data: [{ ...linha(0), modo: 'agente', ia_agente_id: 'ag-1', ia_agente_nome: 'Triagem (nome velho)' }],
        error: null,
        count: 1,
      },
    ]
    const res = await GET(new Request('http://x/api/cb/ia/uso?dias=30'))
    const corpo = (await res.json()) as { resumo: { porAgente: { nome: string; arquivado: boolean }[] } }
    expect(corpo.resumo.porAgente[0]).toMatchObject({ nome: 'Triagem (nome novo)', arquivado: false })
  })
})

describe('GET /api/cb/ia/uso — cotação', () => {
  it('a cotação informada vence, e a PTAX nem é buscada', async () => {
    const res = await GET(new Request('http://x/api/cb/ia/uso'))
    const corpo = (await res.json()) as { cotacao: number; cotacaoManual: number | null; ptax: unknown }
    expect(corpo).toMatchObject({ cotacao: 5.5, cotacaoManual: 5.5, ptax: null })
    expect(buscarPtax).not.toHaveBeenCalled()
  })

  it('sem cotação informada: a PTAX do Banco Central mais o IOF de 3,5%', async () => {
    cotacaoDaConta = null
    const res = await GET(new Request('http://x/api/cb/ia/uso'))
    const corpo = (await res.json()) as Record<string, unknown>
    expect(corpo).toMatchObject({
      cotacao: 5.382,
      cotacaoManual: null,
      ptax: { valor: 5.2, dia: '2026-09-25' },
      iof: 0.035,
    })
  })

  it('PTAX fora do ar e nada informado: cotação nula (sem R$), nunca zero', async () => {
    cotacaoDaConta = null
    buscarPtax.mockResolvedValueOnce(null)
    const res = await GET(new Request('http://x/api/cb/ia/uso'))
    const corpo = (await res.json()) as { cotacao: number | null }
    expect(res.status).toBe(200)
    expect(corpo.cotacao).toBeNull()
  })
})
