import { describe, it, expect } from 'vitest'
import { segundosUteisEntre, formatarDuracaoUtil } from './horario-comercial'

// Instantes em UTC; São Paulo = UTC-3 fixo. 2026-08-26 é uma quarta-feira.
const sp = (dia: string, hora: string) => new Date(`${dia}T${hora}:00-03:00`)

describe('segundosUteisEntre', () => {
  it('conta direto dentro do mesmo expediente', () => {
    expect(segundosUteisEntre(sp('2026-08-26', '10:00'), sp('2026-08-26', '12:30'))).toBe(
      2.5 * 3600,
    )
  })

  it('mensagem às 23h respondida às 8h30 do dia seguinte = 30min úteis', () => {
    expect(segundosUteisEntre(sp('2026-08-26', '23:00'), sp('2026-08-27', '08:30'))).toBe(
      30 * 60,
    )
  })

  it('atravessa a noite: 18h → 09h do dia seguinte = 2h úteis', () => {
    expect(segundosUteisEntre(sp('2026-08-26', '18:00'), sp('2026-08-27', '09:00'))).toBe(
      2 * 3600,
    )
  })

  it('fim de semana não conta: sexta 18h → segunda 09h = 2h úteis', () => {
    expect(segundosUteisEntre(sp('2026-08-28', '18:00'), sp('2026-08-31', '09:00'))).toBe(
      2 * 3600,
    )
  })

  it('sábado inteiro = zero', () => {
    expect(segundosUteisEntre(sp('2026-08-29', '09:00'), sp('2026-08-29', '18:00'))).toBe(0)
  })

  it('intervalo negativo (relógio dessincronizado) vira zero, não número negativo', () => {
    expect(segundosUteisEntre(sp('2026-08-26', '12:00'), sp('2026-08-26', '11:00'))).toBe(0)
  })

  it('um dia útil inteiro = 11h', () => {
    expect(segundosUteisEntre(sp('2026-08-26', '00:00'), sp('2026-08-27', '00:00'))).toBe(
      11 * 3600,
    )
  })
})

describe('formatarDuracaoUtil', () => {
  it('formata minutos, horas e dias úteis', () => {
    expect(formatarDuracaoUtil(30)).toBe('<1min')
    expect(formatarDuracaoUtil(45 * 60)).toBe('45min')
    expect(formatarDuracaoUtil(2 * 3600 + 15 * 60)).toBe('2h 15min')
    // 1 dia útil = 11h; 13h úteis = 1d 2h.
    expect(formatarDuracaoUtil(13 * 3600)).toBe('1d 2h')
  })
})
