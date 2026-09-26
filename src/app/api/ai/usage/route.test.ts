import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/ai/usage — o dia do gráfico é o do FUSO DO ESCRITÓRIO.
//
// A rota roda no servidor, e o contêiner está em UTC (medido em 26/09/2026).
// Com os helpers de "dia local" de `lib/dashboard/date-utils` (feitos para o
// navegador), o dia virava às 21h de Brasília: o uso da noite caía no dia
// seguinte e a janela começava às 21h da véspera. Os pinos abaixo usam
// instantes UTC explícitos, então valem com a máquina em qualquer fuso — e
// falham no código antigo quando ele roda em UTC, como na produção e no CI.
// ============================================================

let linhas: Array<Record<string, unknown>> = []
let desdePedido: string | null = null

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    const q = {
      select: () => q,
      eq: () => q,
      gte: (_coluna: string, valor: string) => {
        desdePedido = valor
        return q
      },
      order: () => q,
      limit: async () => ({ data: linhas, error: null }),
    }
    return { supabase: { from: () => q }, accountId: 'conta-1' }
  }),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))

import { GET } from './route'

function uso(created_at: string, total_tokens: number) {
  return {
    created_at,
    mode: 'auto_reply',
    provider: 'openai',
    model: 'gpt-x',
    prompt_tokens: total_tokens,
    completion_tokens: 0,
    total_tokens,
  }
}

async function pedir(dias: number) {
  const res = await GET(new Request(`http://localhost/api/ai/usage?days=${dias}`))
  expect(res.status).toBe(200)
  return (await res.json()) as {
    totals: { total_tokens: number }
    daily: Array<{ date: string; tokens: number; calls: number }>
  }
}

describe('GET /api/ai/usage — dias no fuso do escritório', () => {
  beforeEach(() => {
    linhas = []
    desdePedido = null
    vi.useFakeTimers({ toFake: ['Date'] })
    // 12/09/2026, 22:30 em Brasília — em UTC já é dia 13.
    vi.setSystemTime(new Date('2026-09-13T01:30:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

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
      uso('2026-09-13T01:00:00Z', 100), // 12/09, 22:00 em Brasília
      uso('2026-09-12T02:00:00Z', 30), // 11/09, 23:00 em Brasília
      uso('2026-09-11T12:00:00Z', 5), // 11/09, 09:00 em Brasília
    ]
    const r = await pedir(7)
    const porDia = Object.fromEntries(r.daily.map((d) => [d.date, d.tokens]))
    expect(porDia['2026-09-12']).toBe(100)
    expect(porDia['2026-09-11']).toBe(35)
    expect(r.daily.reduce((s, d) => s + d.tokens, 0)).toBe(r.totals.total_tokens)
  })
})
