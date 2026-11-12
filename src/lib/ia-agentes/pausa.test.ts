import { describe, expect, it } from 'vitest'

import {
  ehMotivoTemporario,
  lerMinutos,
  MOTIVOS_DA_PAUSA,
  MOTIVOS_TEMPORARIOS,
  VOLTA_APOS_MIN_PADRAO,
  voltaDaPausaEm,
} from './pausa'

// A pausa temporária (1138): os motivos, a configuração da conta e a conta da
// volta. O SQL tem o espelho (pino em `supabase/migrations/pausa-temporaria-1138.test.ts`).

describe('ehMotivoTemporario', () => {
  it('só `gente` e `botao` voltam sozinhas', () => {
    expect(MOTIVOS_TEMPORARIOS).toEqual(['gente', 'botao'])
    expect(MOTIVOS_DA_PAUSA.filter(ehMotivoTemporario)).toEqual(['gente', 'botao'])
    expect(ehMotivoTemporario(null)).toBe(false)
    expect(ehMotivoTemporario(undefined)).toBe(false)
  })
})

describe('lerMinutos', () => {
  it.each<[unknown, number]>([
    [15, 15],
    [0, 0],
    [1440, 1440],
    [1441, VOLTA_APOS_MIN_PADRAO],
    [-1, VOLTA_APOS_MIN_PADRAO],
    [7.5, VOLTA_APOS_MIN_PADRAO],
    ['15', VOLTA_APOS_MIN_PADRAO],
    [null, VOLTA_APOS_MIN_PADRAO],
  ])('%s → %s', (v, esperado) => {
    expect(lerMinutos(v)).toBe(esperado)
  })
})

describe('voltaDaPausaEm', () => {
  const agora = Date.parse('2026-11-11T15:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()
  const MIN = 60_000

  it('conta da 1ª mensagem sem resposta', () => {
    expect(
      voltaDaPausaEm({ agora, aguardandoDesde: iso(agora - 2 * MIN), pausadaEm: iso(agora - 10 * MIN), minutos: 15 }),
    ).toBe(agora + 13 * MIN)
  })

  it('o "Pausar" apertado depois da mensagem recomeça dali', () => {
    expect(
      voltaDaPausaEm({ agora, aguardandoDesde: iso(agora - 30 * MIN), pausadaEm: iso(agora - 5 * MIN), minutos: 15 }),
    ).toBe(agora + 10 * MIN)
  })

  it('sem as datas, conta de agora', () => {
    expect(voltaDaPausaEm({ agora, aguardandoDesde: null, pausadaEm: null, minutos: 15 })).toBe(agora + 15 * MIN)
  })
})
