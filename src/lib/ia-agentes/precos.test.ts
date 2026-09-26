import { describe, expect, it } from 'vitest'

import { AI_PROVIDER_MODELS } from '@/lib/ai/defaults'
import type { AiProvider } from '@/lib/ai/types'
import { precoNoDia } from './precos'

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
})
