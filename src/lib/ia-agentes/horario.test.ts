import { describe, expect, it } from 'vitest'

import { dentroDoHorario } from './horario'

const COMERCIAL = { dias: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' }

describe('dentroDoHorario — no fuso do escritório, nunca no do servidor', () => {
  it('nulo = sempre', () => {
    expect(dentroDoHorario(null, new Date('2026-09-27T03:00:00Z'))).toBe(true)
  })

  it('sexta 17:59 em São Paulo (20:59 UTC) está dentro; 18:00 já está fora (fim exclusivo)', () => {
    expect(dentroDoHorario(COMERCIAL, new Date('2026-09-25T20:59:00Z'))).toBe(true)
    expect(dentroDoHorario(COMERCIAL, new Date('2026-09-25T21:00:00Z'))).toBe(false)
  })

  it('08:00 em São Paulo está dentro; 07:59 fora', () => {
    expect(dentroDoHorario(COMERCIAL, new Date('2026-09-25T11:00:00Z'))).toBe(true)
    expect(dentroDoHorario(COMERCIAL, new Date('2026-09-25T10:59:00Z'))).toBe(false)
  })

  it('o dia é o de São Paulo: sexta 22:00 local é sábado 01:00 UTC, e sexta não é sábado', () => {
    const sabadoUtcSextaLocal = new Date('2026-09-26T01:00:00Z')
    expect(dentroDoHorario({ dias: [5], inicio: '20:00', fim: '23:00' }, sabadoUtcSextaLocal)).toBe(true)
    expect(dentroDoHorario({ dias: [6], inicio: '00:00', fim: '23:59' }, sabadoUtcSextaLocal)).toBe(false)
  })

  it('fim de semana fora do horário comercial', () => {
    expect(dentroDoHorario(COMERCIAL, new Date('2026-09-27T15:00:00Z'))).toBe(false)
  })
})
