import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/ai/usage — o gráfico de uso da página antiga de Agentes.
//
// 1. O dia do gráfico é o do FUSO DO ESCRITÓRIO. A rota roda no servidor, e o
//    contêiner está em UTC (medido em 26/09/2026): com os helpers de "dia
//    local" de `lib/dashboard/date-utils` (feitos para o navegador), o dia
//    virava às 21h de Brasília. Os pinos usam instantes UTC explícitos, então
//    valem com a máquina em qualquer fuso.
// 2. A janela é lida INTEIRA, por chave, ou a rota falha. O PostgREST corta
//    cada resposta em 1.000 linhas (`max_rows`), por mais que se peça: a rota
//    pedia 10.001 de uma vez, somava só as 1.000 mais recentes e o aviso de
//    janela parcial nunca acendia (1.902 registros em 30 dias, e o cartão
//    mostrava "1000 chamadas").
// ============================================================

let linhas: Array<Record<string, unknown>> = []
let desdePedido: string | null = null
let atePedido: string | null = null
let paginas: Array<string | null> = []
let ordens: Array<[string, boolean]> = []
let limites: number[] = []

// Imita o PostgREST: cada `from()` é uma consulta nova; a página traz as linhas
// de `id` maior que o último visto, em ordem de `id`, e nunca mais de 1.000.
function consulta() {
  let depoisDe: string | null = null
  const q = {
    select: () => q,
    eq: () => q,
    gte: (_coluna: string, valor: string) => {
      desdePedido = valor
      return q
    },
    lte: (_coluna: string, valor: string) => {
      atePedido = valor
      return q
    },
    gt: (_coluna: string, valor: string) => {
      depoisDe = valor
      return q
    },
    order: (coluna: string, opcoes?: { ascending?: boolean }) => {
      ordens.push([coluna, opcoes?.ascending ?? true])
      return q
    },
    limit: async (n: number) => {
      paginas.push(depoisDe)
      limites.push(n)
      const resto = depoisDe === null ? linhas : linhas.filter((l) => String(l.id) > (depoisDe as string))
      return { data: resto.slice(0, Math.min(n, 1000)), error: null }
    },
  }
  return q
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ supabase: { from: () => consulta() }, accountId: 'conta-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))

import { GET } from './route'

function uso(id: string, created_at: string, total_tokens: number) {
  return {
    id,
    created_at,
    mode: 'auto_reply',
    provider: 'openai',
    model: 'gpt-x',
    prompt_tokens: total_tokens,
    completion_tokens: 0,
    total_tokens,
  }
}

/** `n` linhas com ids em ordem crescente, todas dentro da janela. */
function muitas(n: number) {
  return Array.from({ length: n }, (_, i) => uso(`u-${String(i).padStart(5, '0')}`, '2026-09-12T15:00:00Z', 1))
}

async function pedir(dias: number) {
  const res = await GET(new Request(`http://localhost/api/ai/usage?days=${dias}`))
  expect(res.status).toBe(200)
  return (await res.json()) as {
    truncated: boolean
    totals: { calls: number; total_tokens: number }
    daily: Array<{ date: string; tokens: number; calls: number }>
  }
}

beforeEach(() => {
  linhas = []
  desdePedido = null
  atePedido = null
  paginas = []
  ordens = []
  limites = []
  vi.useFakeTimers({ toFake: ['Date'] })
  // 12/09/2026, 22:30 em Brasília — em UTC já é dia 13.
  vi.setSystemTime(new Date('2026-09-13T01:30:00Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/ai/usage — dias no fuso do escritório', () => {
  it('a janela começa à meia-noite de Brasília do dia mais antigo, e o último dia é o hoje de Brasília', async () => {
    const r = await pedir(7)
    expect(desdePedido).toBe('2026-09-06T03:00:00.000Z') // 06/09, 00:00 em Brasília
    expect(r.daily.map((d) => d.date)).toEqual([
      '2026-09-06',
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ])
  })

  it('o uso da noite fica no dia de Brasília, e as barras somam o total', async () => {
    linhas = [
      uso('a', '2026-09-13T01:00:00Z', 100), // 12/09, 22:00 em Brasília
      uso('b', '2026-09-12T02:00:00Z', 30), // 11/09, 23:00 em Brasília
      uso('c', '2026-09-11T12:00:00Z', 5), // 11/09, 09:00 em Brasília
    ]
    const r = await pedir(7)
    const porDia = Object.fromEntries(r.daily.map((d) => [d.date, d.tokens]))
    expect(porDia['2026-09-12']).toBe(100)
    expect(porDia['2026-09-11']).toBe(35)
    expect(r.daily.reduce((s, d) => s + d.tokens, 0)).toBe(r.totals.total_tokens)
  })
})

describe('GET /api/ai/usage — a janela INTEIRA, lida por chave', () => {
  it('soma as 2.500 linhas em três páginas, cada uma depois do último id visto', async () => {
    linhas = muitas(2500)
    const r = await pedir(7)
    expect(paginas).toEqual([null, 'u-00999', 'u-01999'])
    expect(r.totals.calls).toBe(2500)
    expect(r.totals.total_tokens).toBe(2500)
    expect(r.daily.reduce((s, d) => s + d.calls, 0)).toBe(2500)
    expect(r.truncated).toBe(false)
  })

  it('exatamente 25.000 linhas cabem: a sondagem vazia prova o fim', async () => {
    linhas = muitas(25_000)
    const r = await pedir(90)
    expect(r.totals.calls).toBe(25_000)
  })

  // Somar só parte da janela e mostrar como se fosse tudo é o defeito que o
  // conserto existe para impedir: acima do teto, a rota falha e o cartão diz.
  it('acima de 25.000 linhas a rota FALHA em vez de mostrar um total parcial', async () => {
    linhas = muitas(25_001)
    const res = await GET(new Request('http://localhost/api/ai/usage?days=90'))
    expect(res.status).toBe(500)
  })

  it('a leitura termina no instante do pedido e pagina por id, de 1.000 em 1.000', async () => {
    await pedir(7)
    expect(atePedido).toBe('2026-09-13T01:30:00.000Z')
    expect(ordens[0]).toEqual(['id', true])
    expect(limites[0]).toBe(1000)
  })
})
