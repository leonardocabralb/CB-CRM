import { describe, expect, it } from 'vitest'

import { AI_PROVIDER_DEFAULT_MODEL, AI_PROVIDER_MODELS } from '@/lib/ai/defaults'
import type { AiProvider } from '@/lib/ai/types'
import { custoEmDolar, LIMIAR_DA_FAIXA, precoNoDia, temFaixa } from './precos'

// A tela do agente SUGERE estes modelos (o <datalist> do campo Modelo). Um
// sugerido sem linha na tabela aparece como "sem preço" na aba Uso e fica fora
// do total em R$ — medido no preview em 26/09/2026 com o gemini-3.5-flash-lite.
describe('tabela de preço', () => {
  it('todo modelo sugerido na tela tem preço', () => {
    const semPreco = (Object.entries(AI_PROVIDER_MODELS) as [AiProvider, readonly string[]][])
      .flatMap(([provedor, modelos]) => modelos.map((modelo) => [provedor, modelo] as const))
      .filter(([provedor, modelo]) => precoNoDia(provedor, modelo, '2026-09-26') === null)
    expect(semPreco).toEqual([])
  })

  it('o modelo PADRÃO de cada provedor tem preço', () => {
    for (const [provedor, modelo] of Object.entries(AI_PROVIDER_DEFAULT_MODEL)) {
      expect(precoNoDia(provedor, modelo, '2026-10-25'), `${provedor}/${modelo}`).not.toBeNull()
    }
  })
})

// Duas tabelas pelo tamanho de CADA pedido (Codex, #439): a soma da 1108
// separa a faixa, e o preço de cada uma vem da linha certa.
describe('o Haiku 5.5 e a faixa do pedido', () => {
  const base = { provedor: 'anthropic', modelo: 'claude-haiku-5-5', dia: '2026-10-25', tokensEntrada: 1_000_000, tokensSaida: 1_000_000, tokensTotal: 2_000_000 }

  it('até 100 mil tokens de entrada: US$ 0,10 / 0,50', () => {
    expect(custoEmDolar({ ...base, acimaDaFaixa: false })).toBeCloseTo(0.1 + 0.5, 6)
  })

  it('acima de 100 mil: US$ 0,50 / 2,50 — entrada E saída', () => {
    expect(custoEmDolar({ ...base, acimaDaFaixa: true })).toBeCloseTo(0.5 + 2.5, 6)
  })

  it('soma sem a faixa (a função de antes da 1108): sem preço, nunca a tabela baixa', () => {
    expect(custoEmDolar({ ...base, acimaDaFaixa: null })).toBeNull()
  })

  it('modelo SEM faixa não depende dela: a mesma tabela nos dois tamanhos, e com a faixa ausente', () => {
    const sonnet = { ...base, modelo: 'claude-sonnet-5-5' }
    expect(custoEmDolar({ ...sonnet, acimaDaFaixa: false })).toBeCloseTo(2 + 10, 6)
    expect(custoEmDolar({ ...sonnet, acimaDaFaixa: true })).toBeCloseTo(2 + 10, 6)
    expect(custoEmDolar({ ...sonnet, acimaDaFaixa: null })).toBeCloseTo(2 + 10, 6)
    expect(custoEmDolar({ ...base, modelo: 'claude-opus-5-5', acimaDaFaixa: false })).toBeCloseTo(4 + 20, 6)
  })

  it('a linha da faixa alta usa o MESMO limiar do banco (`LIMIAR_DA_FAIXA`)', () => {
    expect(LIMIAR_DA_FAIXA).toBe(100_000)
    expect(temFaixa('anthropic', 'claude-haiku-5-5', '2026-10-25')).toBe(true)
    expect(temFaixa('anthropic', 'claude-sonnet-5-5', '2026-10-25')).toBe(false)
    expect(precoNoDia('anthropic', 'claude-haiku-5-5', '2026-10-25', 'acima')?.entrada).toBe(0.5)
    expect(precoNoDia('anthropic', 'claude-haiku-5-5', '2026-10-25')?.entrada).toBe(0.1)
  })
})

// O CACHE do provedor (1129, 09/11/2026): da entrada, o lido paga `cacheLeitura`
// e o gravado `cacheEscrita` (Anthropic: 2× com 1 h); sem os preços na linha,
// erra para CIMA (leitura cheia, gravação a 2×), nunca para baixo.
describe('o cache do provedor no custo (1129)', () => {
  const sonnet = { provedor: 'anthropic', modelo: 'claude-sonnet-5-5', dia: '2026-11-09', acimaDaFaixa: false }

  it('Sonnet: 1M de entrada lida do cache sai a US$ 0,20 (não 2,00); a gravada, a US$ 4,00', () => {
    const lido = custoEmDolar({ ...sonnet, tokensEntrada: 1_000_000, tokensSaida: 0, tokensTotal: 1_000_000, tokensCacheLeitura: 1_000_000 })
    expect(lido).toBeCloseTo(0.2, 6)
    const gravado = custoEmDolar({ ...sonnet, tokensEntrada: 1_000_000, tokensSaida: 0, tokensTotal: 1_000_000, tokensCacheEscrita: 1_000_000 })
    expect(gravado).toBeCloseTo(4, 6)
  })

  it('a chamada medida em 09/11 (10.518 lidos de 10.818): ~US$ 0,0086, contra 0,0266 sem cache', () => {
    const u = { ...sonnet, tokensEntrada: 10_818, tokensSaida: 500, tokensTotal: 11_318 }
    expect(custoEmDolar(u)).toBeCloseTo((10_818 * 2 + 500 * 10) / 1e6, 8)
    expect(custoEmDolar({ ...u, tokensCacheLeitura: 10_518 })).toBeCloseTo((300 * 2 + 10_518 * 0.2 + 500 * 10) / 1e6, 8)
  })

  it('Gemini: o lido do cache implícito a 10% (US$ 0,075 até 31/12; 0,15 a partir de 2027)', () => {
    const g = { provedor: 'gemini', modelo: 'gemini-3.8-flash', acimaDaFaixa: false, tokensEntrada: 1_000_000, tokensSaida: 0, tokensTotal: 1_000_000, tokensCacheLeitura: 1_000_000 }
    expect(custoEmDolar({ ...g, dia: '2026-12-31' })).toBeCloseTo(0.075, 6)
    expect(custoEmDolar({ ...g, dia: '2027-01-01' })).toBeCloseTo(0.15, 6)
  })

  it('linha SEM preço de cache: a leitura a preço cheio e a gravação a 2× (erra para cima)', () => {
    const g = { provedor: 'gemini', modelo: 'gemini-3.5-flash', dia: '2026-11-09', acimaDaFaixa: false, tokensSaida: 0 }
    expect(custoEmDolar({ ...g, tokensEntrada: 1_000_000, tokensTotal: 1_000_000, tokensCacheLeitura: 1_000_000 })).toBeCloseTo(1.5, 6)
    expect(custoEmDolar({ ...g, tokensEntrada: 1_000_000, tokensTotal: 1_000_000, tokensCacheEscrita: 1_000_000 })).toBeCloseTo(3, 6)
  })

  it('soma torta (cache maior que a entrada) nunca dá entrada negativa', () => {
    expect(custoEmDolar({ ...sonnet, tokensEntrada: 100, tokensSaida: 0, tokensTotal: 100, tokensCacheLeitura: 1_000_000 })).toBeCloseTo(0.2, 6)
  })

  it('todo modelo da Anthropic e do Gemini 3.x Flash da tabela tem o preço da leitura de cache', () => {
    for (const m of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      const p = precoNoDia('anthropic', m, '2026-11-09')
      expect(p?.cacheLeitura, m).toBeDefined()
      expect(p?.cacheEscrita, m).toBeCloseTo(2 * (p?.entrada ?? 0), 6)
    }
    expect(precoNoDia('anthropic', 'claude-haiku-5-5', '2026-11-09', 'acima')?.cacheEscrita).toBeCloseTo(1, 6)
    for (const m of ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']) {
      expect(precoNoDia('gemini', m, '2026-11-09')?.cacheLeitura, m).toBe(0.075)
      expect(precoNoDia('gemini', m, '2027-01-01')?.cacheLeitura, m).toBe(0.15)
    }
  })
})
