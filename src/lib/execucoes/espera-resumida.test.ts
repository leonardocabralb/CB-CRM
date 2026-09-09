import { describe, it, expect } from 'vitest'
import { lerResumo, RESUMO_VAZIO } from './espera-resumida'

describe('lerResumo', () => {
  it('lê o corpo bom', () => {
    const r = lerResumo({
      contatos: {
        'c-1': { esperas: 3, proxima: '2026-09-10T12:00:00Z' },
        'c-2': { esperas: 1, proxima: '2026-09-09T12:00:00Z' },
      },
      truncado: false,
    })
    expect(r.porContato['c-1'].esperas).toBe(3)
    expect(r.porContato['c-2'].proxima).toBe('2026-09-09T12:00:00Z')
    expect(r.truncado).toBe(false)
  })

  it('propaga o truncado', () => {
    // ⚠️ Sem este sinal, um teto silencioso faria a marca DESAPARECER de parte
    // dos clientes — e ausência de marca é lida como "nada rodando".
    expect(lerResumo({ contatos: {}, truncado: true }).truncado).toBe(true)
  })

  it('contato com ZERO espera não entra — a fila dele esvaziou', () => {
    const r = lerResumo({ contatos: { 'c-1': { esperas: 0, proxima: '' } } })
    expect(r.porContato['c-1']).toBeUndefined()
  })

  it('corpo malformado vira resumo VAZIO, nunca undefined solto', () => {
    // Página de erro de proxy, corpo truncado, resposta de outra rota. Um cast
    // entregaria `undefined` ao render e quebraria a lista no meio.
    expect(lerResumo(null)).toEqual(RESUMO_VAZIO)
    expect(lerResumo('não é objeto')).toEqual(RESUMO_VAZIO)
    expect(lerResumo({})).toEqual(RESUMO_VAZIO)
    expect(lerResumo({ contatos: [] })).toEqual(RESUMO_VAZIO)
    expect(lerResumo({ contatos: 'x' })).toEqual(RESUMO_VAZIO)
  })

  it('entrada de contato com forma errada é descartada, sem derrubar as boas', () => {
    const r = lerResumo({
      contatos: {
        ruim: 'texto',
        pior: null,
        'sem-numero': { esperas: 'três', proxima: '2026-09-10T12:00:00Z' },
        boa: { esperas: 2, proxima: '2026-09-10T12:00:00Z' },
      },
    })
    expect(Object.keys(r.porContato)).toEqual(['boa'])
  })

  it('espera sem hora ainda conta — a marca não depende do "quando"', () => {
    // O `title` fica sem a data, e a marca continua verdadeira: há algo na
    // fila. Descartar a linha esconderia um robô rodando.
    const r = lerResumo({ contatos: { 'c-1': { esperas: 1 } } })
    expect(r.porContato['c-1']).toEqual({ esperas: 1, proxima: '' })
  })
})
