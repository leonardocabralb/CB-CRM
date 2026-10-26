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
