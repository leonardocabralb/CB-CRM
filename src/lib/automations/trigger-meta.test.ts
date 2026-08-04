import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatRelative } from './trigger-meta'

// ------------------------------------------------------------
// `formatRelative` alimenta três telas em produção (lista de automações,
// histórico e o painel por etapa da Fase 5). Ela devolvia `5m ago` e `never`
// crus, em inglês, dentro de um app em português — a mesma família de erro
// que o CLAUDE.md já proíbe para `toLocaleDateString('en-US')`.
//
// Os testes abaixo checam a ESTRUTURA (que unidade foi escolhida, com que
// sinal), não o texto de uma língua: o texto vem do `Intl` do runtime.
// ------------------------------------------------------------

const AGORA = new Date('2026-08-04T12:00:00Z').getTime()

function comRelogioParadoEm(ms: number, fn: () => void) {
  vi.useFakeTimers()
  vi.setSystemTime(ms)
  try {
    fn()
  } finally {
    vi.useRealTimers()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('formatRelative — o texto de "nunca"', () => {
  it('nulo e indefinido devolvem o texto passado', () => {
    expect(formatRelative(null, 'nunca')).toBe('nunca')
    expect(formatRelative(undefined, 'nunca')).toBe('nunca')
  })

  it('data ilegível NÃO vira "Invalid Date" na tela', () => {
    // Coluna preenchida à mão pela API pública, ou lixo de migração.
    expect(formatRelative('não é data', 'nunca')).toBe('nunca')
  })

  it('o padrão em inglês só existe para quem não passa o texto', () => {
    // Se este teste começar a incomodar, o certo é passar o texto no call
    // site — não trocar o padrão por português, que quebraria o inglês.
    expect(formatRelative(null)).toBe('never')
  })
})

describe('formatRelative — escolha da unidade', () => {
  const fmt = (rel: number, unit: Intl.RelativeTimeFormatUnit) =>
    new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(rel, unit)

  it('segundos abaixo de 1 minuto', () => {
    comRelogioParadoEm(AGORA, () => {
      const trintaSegAtras = new Date(AGORA - 30_000).toISOString()
      expect(formatRelative(trintaSegAtras, 'x')).toBe(fmt(-30, 'second'))
    })
  })

  it('minutos abaixo de 1 hora', () => {
    comRelogioParadoEm(AGORA, () => {
      const dezMinAtras = new Date(AGORA - 10 * 60_000).toISOString()
      expect(formatRelative(dezMinAtras, 'x')).toBe(fmt(-10, 'minute'))
    })
  })

  it('horas abaixo de 1 dia', () => {
    comRelogioParadoEm(AGORA, () => {
      const cincoHorasAtras = new Date(AGORA - 5 * 3_600_000).toISOString()
      expect(formatRelative(cincoHorasAtras, 'x')).toBe(fmt(-5, 'hour'))
    })
  })

  it('dias abaixo de 30', () => {
    comRelogioParadoEm(AGORA, () => {
      const treseDiasAtras = new Date(AGORA - 13 * 86_400_000).toISOString()
      expect(formatRelative(treseDiasAtras, 'x')).toBe(fmt(-13, 'day'))
    })
  })

  it('além de 30 dias vira data absoluta', () => {
    comRelogioParadoEm(AGORA, () => {
      const iso = new Date(AGORA - 90 * 86_400_000).toISOString()
      expect(formatRelative(iso, 'x')).toBe(new Date(iso).toLocaleDateString())
    })
  })

  it('CRÍTICO: o sinal é NEGATIVO — é passado, não futuro', () => {
    // Com o sinal trocado a tela diria "daqui a 10 minutos" sobre um disparo
    // que já aconteceu, e ninguém questiona um relógio.
    comRelogioParadoEm(AGORA, () => {
      const saida = formatRelative(new Date(AGORA - 10 * 60_000).toISOString(), 'x')
      expect(saida).toBe(fmt(-10, 'minute'))
      expect(saida).not.toBe(fmt(10, 'minute'))
    })
  })
})
