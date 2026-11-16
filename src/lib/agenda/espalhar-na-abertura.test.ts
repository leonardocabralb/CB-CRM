import { describe, expect, it } from 'vitest'

import {
  deslocamentoNaAbertura,
  ESPALHAR_NA_ABERTURA_MS,
  FOLGA_NO_FIM_DA_JANELA_MS,
  larguraDoEspalhamento,
} from './espalhar-na-abertura'

describe('deslocamentoNaAbertura — o instante próprio de cada um na primeira hora', () => {
  it('é a primeira hora depois da abertura', () => {
    expect(ESPALHAR_NA_ABERTURA_MS).toBe(60 * 60_000)
  })

  it('a mesma semente dá sempre o mesmo deslocamento (recalculado ao armar e ao rodar)', () => {
    const a = deslocamentoNaAbertura('conversa-1:2')
    expect(deslocamentoNaAbertura('conversa-1:2')).toBe(a)
  })

  it('fica em [0, largura), em segundos inteiros', () => {
    for (let i = 0; i < 500; i++) {
      const d = deslocamentoNaAbertura(`semente-${i}`)
      expect(d).toBeGreaterThanOrEqual(0)
      expect(d).toBeLessThan(ESPALHAR_NA_ABERTURA_MS)
      expect(d % 1000).toBe(0)
    }
    const curta = 10 * 60_000
    for (let i = 0; i < 100; i++) expect(deslocamentoNaAbertura(`x${i}`, curta)).toBeLessThan(curta)
  })

  it('a largura: a primeira hora, deixando 5 min livres no fim da janela (Codex, #521)', () => {
    expect(FOLGA_NO_FIM_DA_JANELA_MS).toBe(5 * 60_000)
    expect(larguraDoEspalhamento(13 * 60 * 60_000)).toBe(ESPALHAR_NA_ABERTURA_MS) // 08:00–21:00
    expect(larguraDoEspalhamento(15 * 60_000)).toBe(10 * 60_000) // 00:30–00:45
    expect(larguraDoEspalhamento(5 * 60_000)).toBe(0)
    expect(larguraDoEspalhamento(60_000)).toBe(0) // 08:00–08:01: a abertura exata
  })

  it('largura de menos de 1 s: zero', () => {
    expect(deslocamentoNaAbertura('qualquer', 0)).toBe(0)
    expect(deslocamentoNaAbertura('qualquer', 999)).toBe(0)
    expect(deslocamentoNaAbertura('qualquer', -5)).toBe(0)
  })

  it('⚠️ ESPALHA de fato: as oito conversas da manhã de 16/11 não saem juntas', () => {
    // Medido: oito follow-ups em 9 s às 08:00. Com ids de conversa (uuid) e a
    // tentativa como semente, nenhum par fica a menos de 30 s um do outro, e
    // eles cobrem a hora.
    const sementes = [
      '0b7c1e52-5d0a-4a43-9f39-0a1d2c3b4e5f:3',
      '1c8d2f63-6e1b-4b54-8a4a-1b2e3d4c5f60:2',
      '2d9e3074-7f2c-4c65-9b5b-2c3f4e5d6071:4',
      '3eaf4185-803d-4d76-8c6c-3d405f6e7182:2',
      '4fb05296-914e-4e87-9d7d-4e5160718293:5',
      '50c163a7-a25f-4f98-8e8e-5f62718293a4:3',
      '61d274b8-b360-40a9-9f9f-6073829304b5:2',
      '72e385c9-c471-41ba-80a0-718493a415c6:6',
    ]
    const ds = sementes.map((s) => deslocamentoNaAbertura(s)).sort((a, b) => a - b)
    for (let i = 1; i < ds.length; i++) expect(ds[i] - ds[i - 1]).toBeGreaterThanOrEqual(30_000)
    expect(ds[ds.length - 1] - ds[0]).toBeGreaterThan(30 * 60_000)
  })

  it('a distribuição cobre a hora inteira (cada quarto de hora recebe a sua parte)', () => {
    const quartos = [0, 0, 0, 0]
    for (let i = 0; i < 2000; i++) quartos[Math.floor(deslocamentoNaAbertura(`c-${i}:1`) / (15 * 60_000))]++
    for (const q of quartos) expect(q).toBeGreaterThan(350)
  })
})
