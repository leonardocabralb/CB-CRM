import { describe, expect, it } from 'vitest'

import { HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { lerPassagem, montarPedidoDoAgente } from './pedido'

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

describe('a PASSAGEM (D25)', () => {
  const agora = new Date('2026-09-25T17:05:00Z')

  it('lista os agentes numerados, com a descrição, e ensina o [[PASSAR:n]]', () => {
    const p = montarPedidoDoAgente({
      instrucoes: 'Triagem.',
      regras: [],
      agora,
      passagens: [
        { nome: 'Cobrança', descricao: 'boletos e segunda via' },
        { nome: 'Trabalhista', descricao: '' },
      ],
    })
    expect(p).toContain('[[PASSAR:n]]')
    expect(p).toContain('1. Cobrança — boletos e segunda via')
    expect(p).toContain('2. Trabalhista')
    expect(p).not.toContain('2. Trabalhista —')
  })

  it('sem agentes para passar, o pedido não fala de passagem', () => {
    expect(montarPedidoDoAgente({ instrucoes: 'x', regras: [], agora })).not.toContain('PASSAR')
    expect(montarPedidoDoAgente({ instrucoes: 'x', regras: [], agora, passagens: [] })).not.toContain('PASSAR')
  })

  it('lerPassagem: o marcador exato, com espaço ou caixa diferentes, e no meio do texto', () => {
    expect(lerPassagem('[[PASSAR:2]]')).toBe(2)
    expect(lerPassagem('  [[ passar : 1 ]]\n')).toBe(1)
    expect(lerPassagem('Vou te passar para o setor certo. [[PASSAR:3]]')).toBe(3)
  })

  it('lerPassagem: texto comum não é passagem', () => {
    expect(lerPassagem('Posso passar o boleto agora?')).toBeNull()
    expect(lerPassagem('[[PASSAR:]]')).toBeNull()
    expect(lerPassagem('[PASSAR:1]')).toBeNull()
  })
})
