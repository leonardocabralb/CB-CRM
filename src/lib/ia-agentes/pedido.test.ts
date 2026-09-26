import { describe, expect, it } from 'vitest'

import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { montarPedidoDoAgente } from './pedido'

const AGORA = new Date('2026-09-25T17:05:00Z')

describe('montarPedidoDoAgente', () => {
  it('instruções e depois as REGRAS numeradas (D23)', () => {
    const p = montarPedidoDoAgente({
      instrucoes: 'Você faz a triagem.',
      regras: ['Nunca prometa resultado.', '  ', 'Não fale de valores.'],
      agora: AGORA,
    })
    const i = p.indexOf('Você faz a triagem.')
    const r = p.indexOf('1. Nunca prometa resultado.')
    expect(i).toBeGreaterThan(-1)
    expect(r).toBeGreaterThan(i)
    expect(p).toContain('2. Não fale de valores.')
    expect(p).not.toContain('3.')
  })

  it('sem regras não há bloco de regras', () => {
    expect(montarPedidoDoAgente({ instrucoes: 'x', regras: [], agora: AGORA })).not.toMatch(/Rules you must/)
  })

  it('a data e a hora no fuso do escritório', () => {
    const p = montarPedidoDoAgente({ instrucoes: '', regras: [], agora: AGORA })
    // 17:05 UTC = 14:05 em São Paulo.
    expect(p).toMatch(/14:05/)
    expect(p).toMatch(/2026/)
  })

  it('ensina a transferência e trata o cliente como conteúdo não confiável', () => {
    const p = montarPedidoDoAgente({ instrucoes: '', regras: [], agora: AGORA })
    expect(p).toContain(HANDOFF_SENTINEL)
    expect(p).toMatch(/untrusted/)
  })

  it('trechos da base entram por último, numerados', () => {
    const p = montarPedidoDoAgente({ instrucoes: 'a', regras: ['b'], agora: AGORA, conhecimento: ['T1', 'T2'] })
    expect(p.indexOf('[1] T1')).toBeGreaterThan(p.indexOf('1. b'))
    expect(p).toContain('[2] T2')
  })
})
