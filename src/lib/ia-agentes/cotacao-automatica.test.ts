import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buscarPtax, comIof, esquecerPtax, lerPtax, urlDaPtax } from './cotacao-automatica'

// A forma MEDIDA da API do Olinda em 26/09/2026 (CotacaoDolarPeriodo).
const RESPOSTA = {
  '@odata.context': 'https://was-p.bcnet.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata$metadata#_CotacaoDolarPeriodo(cotacaoVenda,dataHoraCotacao)',
  value: [
    { cotacaoCompra: 5.1111, cotacaoVenda: 5.1117, dataHoraCotacao: '2026-09-21 13:06:51.445645' },
    { cotacaoCompra: 5.1985, cotacaoVenda: 5.1991, dataHoraCotacao: '2026-09-25 13:10:17.447657' },
    { cotacaoCompra: 5.1789, cotacaoVenda: 5.1795, dataHoraCotacao: '2026-09-24 13:03:18.656275' },
  ],
}

function resposta(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  esquecerPtax()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('lerPtax', () => {
  it('pega a de VENDA do boletim mais recente, mesmo fora de ordem', () => {
    expect(lerPtax(RESPOSTA)).toEqual({ valor: 5.1991, dia: '2026-09-25' })
  })

  it('forma estranha ou lista vazia → null, nunca um número inventado', () => {
    expect(lerPtax(null)).toBeNull()
    expect(lerPtax({ value: [] })).toBeNull()
    expect(lerPtax({ value: [{ cotacaoVenda: '5,2', dataHoraCotacao: '2026-09-25 13:00' }] })).toBeNull()
    expect(lerPtax({ value: [{ cotacaoVenda: 0, dataHoraCotacao: '2026-09-25 13:00' }] })).toBeNull()
  })
})

describe('comIof e a URL', () => {
  it('soma 3,5% de IOF, em 4 casas', () => {
    expect(comIof(5.1991)).toBe(5.3811)
  })

  it('pede os últimos 10 dias no formato MM-DD-YYYY', () => {
    const url = urlDaPtax(new Date('2026-09-26T15:00:00-03:00'))
    expect(url).toContain("@dataInicial='09-16-2026'")
    expect(url).toContain("@dataFinalCotacao='09-26-2026'")
    expect(url.startsWith('https://olinda.bcb.gov.br/')).toBe(true)
  })
})

describe('buscarPtax', () => {
  it('guarda por 6 h: a segunda carga não pede de novo', async () => {
    const f = vi.fn(async () => resposta(RESPOSTA))
    const agora = new Date('2026-09-26T15:00:00-03:00')
    expect(await buscarPtax(agora, f)).toEqual({ valor: 5.1991, dia: '2026-09-25' })
    expect(await buscarPtax(new Date(agora.getTime() + 60 * 60_000), f)).toEqual({ valor: 5.1991, dia: '2026-09-25' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('Banco Central fora do ar: a última que deu certo; sem nenhuma, null', async () => {
    const agora = new Date('2026-09-26T15:00:00-03:00')
    expect(await buscarPtax(agora, vi.fn(async () => resposta({}, 503)))).toBeNull()
    await buscarPtax(agora, vi.fn(async () => resposta(RESPOSTA)))
    const depois = new Date(agora.getTime() + 7 * 60 * 60_000)
    expect(await buscarPtax(depois, vi.fn(async () => { throw new Error('rede') }))).toEqual({ valor: 5.1991, dia: '2026-09-25' })
  })
})
