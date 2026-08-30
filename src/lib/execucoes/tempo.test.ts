import { describe, expect, it } from 'vitest'

import { relativoAoInstante } from './tempo'

// Os textos dependem do locale do runtime, então cada caso calcula o
// ESPERADO com a mesma API — o teste fixa unidade e direção, não a frase.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const AGORA = Date.UTC(2026, 7, 30, 12, 0, 0) // 2026-08-30T12:00:00Z

function iso(msDepoisDeAgora: number): string {
  return new Date(AGORA + msDepoisDeAgora).toISOString()
}

describe('relativoAoInstante', () => {
  it('futuro em minutos', () => {
    expect(relativoAoInstante(iso(5 * 60_000), AGORA)).toBe(rtf.format(5, 'minute'))
  })

  it('futuro em horas', () => {
    expect(relativoAoInstante(iso(3 * 3_600_000), AGORA)).toBe(rtf.format(3, 'hour'))
  })

  it('futuro em dias', () => {
    expect(relativoAoInstante(iso(2 * 86_400_000), AGORA)).toBe(rtf.format(2, 'day'))
  })

  it('passado em horas (espera vencida que o cron ainda não recolheu)', () => {
    expect(relativoAoInstante(iso(-2 * 3_600_000), AGORA)).toBe(rtf.format(-2, 'hour'))
  })

  it('segundos, nos dois sentidos', () => {
    expect(relativoAoInstante(iso(30_000), AGORA)).toBe(rtf.format(30, 'second'))
    expect(relativoAoInstante(iso(-30_000), AGORA)).toBe(rtf.format(-30, 'second'))
  })

  it('além de ~30 dias cai para a data absoluta', () => {
    const distante = iso(45 * 86_400_000)
    expect(relativoAoInstante(distante, AGORA)).toBe(
      new Date(distante).toLocaleDateString(),
    )
  })

  it('data inválida devolve o texto cru, sem estourar', () => {
    expect(relativoAoInstante('nao-e-data', AGORA)).toBe('nao-e-data')
  })
})
