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

  // Duas tabelas pelo tamanho de CADA pedido, e `cb_ia_uso` soma o dia: com a
  // tabela baixa, o PDF longo da leitura sairia 5× mais barato (Codex, #439).
  it('o Haiku 5.5 fica sem preço enquanto a soma não separa a faixa acima de 100 mil tokens', () => {
    expect(precoNoDia('anthropic', 'claude-haiku-5-5', '2026-10-25')).toBeNull()
  })
})
