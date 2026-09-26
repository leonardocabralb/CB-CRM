import { describe, expect, it } from 'vitest'

import { custoEmDolar, precoNoDia } from './precos'
import { lerLinhaDeUso, resumirUso, type LinhaDeUso } from './uso'

const A = '11111111-1111-4111-8111-111111111111'

function linha(p: Partial<LinhaDeUso>): LinhaDeUso {
  return {
    dia: '2026-09-25',
    modo: 'agente_teste',
    iaAgenteId: A,
    iaAgenteNome: 'Triagem',
    provedor: 'gemini',
    modelo: 'gemini-3.7-flash',
    chamadas: 1,
    tokensEntrada: 1_000_000,
    tokensSaida: 1_000_000,
    tokensTotal: 2_000_000,
    ...p,
  }
}

describe('preços', () => {
  it('a vigência: o Gemini Flash dobra em 01/01/2027, e o histórico fica com o preço do dia', () => {
    expect(precoNoDia('gemini', 'gemini-3.7-flash', '2026-12-31')?.entrada).toBe(0.75)
    expect(precoNoDia('gemini', 'gemini-3.7-flash', '2027-01-01')?.entrada).toBe(1.5)
  })
  it('modelo fora da tabela = sem preço (null), nunca zero', () => {
    expect(custoEmDolar({ provedor: 'gemini', modelo: 'x', dia: '2026-09-25', tokensEntrada: 10, tokensSaida: 10, tokensTotal: 20 })).toBeNull()
  })
  it('os pensamentos do Gemini (total − entrada) contam como saída', () => {
    // 1M entrada, 0 saída declarada, 2M total → 1M de saída cobrada.
    const d = custoEmDolar({ provedor: 'gemini', modelo: 'gemini-3.7-flash', dia: '2026-09-25', tokensEntrada: 1_000_000, tokensSaida: 0, tokensTotal: 2_000_000 })
    expect(d).toBeCloseTo(0.75 + 3.75, 6)
  })
})

describe('resumirUso', () => {
  it('produção e teste separados por agente, em R$ pela cotação', () => {
    const r = resumirUso([linha({}), linha({ modo: 'agente', chamadas: 2 })], 5)
    expect(r.porAgente).toHaveLength(1)
    expect(r.porAgente[0].teste.dolar).toBeCloseTo(4.5, 6)
    expect(r.porAgente[0].teste.reais).toBeCloseTo(22.5, 6)
    expect(r.porAgente[0].producao.chamadas).toBe(2)
  })

  it('sem cotação: dólar sim, reais nulo', () => {
    const r = resumirUso([linha({})], null)
    expect(r.total.dolar).toBeCloseTo(4.5, 6)
    expect(r.total.reais).toBeNull()
  })

  it('custo parcial é DITO: o modelo sem preço entra em semPreco', () => {
    const r = resumirUso([linha({}), linha({ modelo: 'desconhecido' })], 5)
    expect(r.semPreco).toEqual(['gemini/desconhecido'])
    expect(r.total.dolar).toBeCloseTo(4.5, 6)
    expect(r.total.chamadas).toBe(2)
  })

  it('grupo com parte SEM preço é marcado `parcial` (o total em R$ soma só o resto)', () => {
    const r = resumirUso(
      [linha({ modo: 'agente' }), linha({ modo: 'agente', modelo: 'modelo-sem-preco' })],
      5,
    )
    expect(r.porAgente[0].producao.parcial).toBe(true)
    expect(r.porAgente[0].producao.dolar).toBeCloseTo(0.75 + 3.75, 6)
    expect(r.total.parcial).toBe(true)
    const inteiro = resumirUso([linha({ modo: 'agente' })], 5)
    expect(inteiro.porAgente[0].producao.parcial).toBe(false)
  })

  it('"sem preço" do AGENTE lista só os modelos dele — o do Radar fica na conta (revisão da F1b)', () => {
    const r = resumirUso(
      [linha({ modo: 'agente' }), linha({ modo: 'radar', iaAgenteId: null, iaAgenteNome: null, modelo: 'radar-sem-preco' })],
      5,
    )
    expect(r.semPreco).toEqual(['gemini/radar-sem-preco'])
    expect(r.porAgente[0].semPreco).toEqual([])
    expect(r.porAgente[0].arquivado).toBe(false)
  })

  it('Radar e transcrição ficam na conta, fora dos agentes', () => {
    const r = resumirUso([linha({ modo: 'radar', iaAgenteId: null, iaAgenteNome: null })], 5)
    expect(r.porAgente).toHaveLength(0)
    expect(r.porModo.radar.chamadas).toBe(1)
  })

  it('dias em ordem', () => {
    const r = resumirUso([linha({ dia: '2026-09-25' }), linha({ dia: '2026-09-24' })], null)
    expect(r.porDia.map((d) => d.dia)).toEqual(['2026-09-24', '2026-09-25'])
  })
})

describe('lerLinhaDeUso', () => {
  it('bigint chega como texto do PostgREST e vira número', () => {
    const l = lerLinhaDeUso({ dia: '2026-09-25', modo: 'agente', provedor: 'gemini', modelo: 'm', chamadas: '3', tokens_entrada: '10', tokens_saida: 5, tokens_total: '15' })
    expect(l).toMatchObject({ chamadas: 3, tokensEntrada: 10, tokensSaida: 5, tokensTotal: 15, iaAgenteId: null })
  })
  it('forma estranha é descartada', () => {
    expect(lerLinhaDeUso({ dia: 1 })).toBeNull()
  })
})
