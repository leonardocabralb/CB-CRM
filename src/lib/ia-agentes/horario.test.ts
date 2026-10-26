import { describe, expect, it } from 'vitest'

import { FUSO_DO_ESCRITORIO as FUSO_DE_CAMPO_DATA } from '@/lib/contacts/campo-data'

import { aberturaDeHoje, dentroDoHorario, proximaAbertura } from './horario'
import { FUSO_DO_ESCRITORIO as FUSO_DO_PEDIDO } from './pedido'

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

describe('o fuso do horário é o do pedido', () => {
  it('a constante de campo-data (a deste módulo) é a mesma de pedido.ts (a do `dataEHora`)', () => {
    expect(FUSO_DE_CAMPO_DATA).toBe(FUSO_DO_PEDIDO)
  })
})

// FORA DO HORÁRIO NÃO É "NUNCA" (25/10/2026): o turno espera a PRÓXIMA abertura.
describe('proximaAbertura — o turno fora do horário espera por ela', () => {
  it('nulo = sem horário (sempre aberto): nada a esperar', () => {
    expect(proximaAbertura(null, new Date('2026-09-27T03:00:00Z'))).toBeNull()
  })

  it('dentro do horário, é agora', () => {
    const agora = new Date('2026-09-25T15:00:00Z') // sexta 12:00 em SP
    expect(proximaAbertura(COMERCIAL, agora)).toBe(agora.getTime())
  })

  it('antes do início, no mesmo dia: o início de hoje (07:30 → 08:00 de sexta)', () => {
    expect(proximaAbertura(COMERCIAL, new Date('2026-09-25T10:30:00Z'))).toBe(Date.parse('2026-09-25T11:00:00Z'))
  })

  it('depois do fim: o início do próximo dia do horário (sexta 18:00 → segunda 08:00, pulando o fim de semana)', () => {
    expect(proximaAbertura(COMERCIAL, new Date('2026-09-25T21:00:00Z'))).toBe(Date.parse('2026-09-28T11:00:00Z'))
  })

  it('⚠️ o dia é o de São Paulo: sexta 22:00 local (sábado 01:00 UTC) abre na segunda, nunca no "sábado" do UTC', () => {
    expect(proximaAbertura(COMERCIAL, new Date('2026-09-26T01:00:00Z'))).toBe(Date.parse('2026-09-28T11:00:00Z'))
  })

  it('madrugada de um dia do horário: o início desse dia', () => {
    // Terça 02:00 em SP (05:00 UTC) → terça 08:00.
    expect(proximaAbertura(COMERCIAL, new Date('2026-09-29T05:00:00Z'))).toBe(Date.parse('2026-09-29T11:00:00Z'))
  })

  it('⚠️ sem laço: fora do horário a abertura é SEMPRE depois de agora, e nela o agente está dentro do horário', () => {
    const horarios = [COMERCIAL, { dias: [6], inicio: '09:30', fim: '12:00' }, { dias: [0, 3], inicio: '00:00', fim: '00:30' }]
    // A cada 37 min de uma semana inteira (pega as bordas de minuto em vários pontos).
    for (const h of horarios) {
      for (let t = Date.parse('2026-09-21T00:00:00Z'); t < Date.parse('2026-09-28T00:00:00Z'); t += 37 * 60_000) {
        const agora = new Date(t)
        const abertura = proximaAbertura(h, agora)
        expect(abertura).not.toBeNull()
        if (dentroDoHorario(h, agora)) {
          expect(abertura).toBe(t)
        } else {
          expect(abertura as number).toBeGreaterThan(t)
          expect(dentroDoHorario(h, new Date(abertura as number))).toBe(true)
          // E é a PRIMEIRA: um minuto antes ainda está fora.
          expect(dentroDoHorario(h, new Date((abertura as number) - 60_000))).toBe(false)
        }
      }
    }
  })
})

describe('aberturaDeHoje — a referência das esperas de quem esperou o horário', () => {
  it('dentro do horário: o início de hoje no fuso do escritório', () => {
    expect(aberturaDeHoje(COMERCIAL, new Date('2026-09-25T15:00:00Z'))).toBe(Date.parse('2026-09-25T11:00:00Z'))
  })

  it('nulo sem horário (sempre aberto) e fora do horário', () => {
    expect(aberturaDeHoje(null, new Date('2026-09-25T15:00:00Z'))).toBeNull()
    expect(aberturaDeHoje(COMERCIAL, new Date('2026-09-27T15:00:00Z'))).toBeNull()
  })

  it('o dia é o de São Paulo: sexta 22:00 local (sábado 01:00 UTC) com horário até 23:00 → sexta 20:00', () => {
    expect(aberturaDeHoje({ dias: [5], inicio: '20:00', fim: '23:00' }, new Date('2026-09-26T01:00:00Z'))).toBe(
      Date.parse('2026-09-25T23:00:00Z'),
    )
  })
})
