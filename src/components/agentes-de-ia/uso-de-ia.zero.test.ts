import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Uso de IA — período sem chamada nenhuma custa ZERO, nunca "sem preço": a
// mesma tela diz 0 tokens em 0 chamadas (Codex, #295).
const fonte = readFileSync(join(__dirname, 'uso-de-ia.tsx'), 'utf8')

describe('uso-de-ia — período sem chamadas', () => {
  it('confere as chamadas ANTES de ler o dólar nulo como "sem preço"', () => {
    const corpo = fonte.slice(fonte.indexOf('const reais = (s: Soma) => {'))
    const zero = corpo.indexOf('if (s.chamadas === 0) return formatCurrency(0)')
    const semPreco = corpo.indexOf("t('uso.semPreco')")
    expect(zero).toBeGreaterThan(-1)
    expect(zero).toBeLessThan(semPreco)
  })
})
