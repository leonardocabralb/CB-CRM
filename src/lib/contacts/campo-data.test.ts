import { describe, it, expect } from 'vitest'
import {
  FUSO_DO_ESCRITORIO,
  formatarParaMensagem,
  paraEntradaLocal,
  deEntradaLocal,
  instanteCanonico,
} from './campo-data'

// ------------------------------------------------------------
// O formato que vai para MENSAGEM (escolhido pelo operador em 2026-09-08).
//
// Estes testes existem porque o modo de falha aqui é silencioso e chega ao
// cliente: a coluna guarda ISO em UTC, o contêiner roda em UTC, e o lembrete
// de reunião diz uma hora. Errar por três horas não estoura em lugar nenhum —
// só faz o cliente aparecer na hora errada.
// ------------------------------------------------------------

describe('formatarParaMensagem', () => {
  it('UTC → hora de Brasília, no formato do pedido', () => {
    expect(formatarParaMensagem('2026-08-30T19:00:00Z')).toBe('30/08/2026 às 16:00h')
  })

  it('aceita ISO com deslocamento escrito (o que o Calendly manda)', () => {
    expect(formatarParaMensagem('2026-08-30T16:00:00-03:00')).toBe('30/08/2026 às 16:00h')
  })

  it('meia-noite não vira 24:00', () => {
    // `hourCycle: 'h23'`. Sem ele o pt-BR devolve "24:00" e a data ANTERIOR,
    // então "sua reunião é dia 30 às 24:00h" para uma reunião do dia 31.
    expect(formatarParaMensagem('2026-08-31T03:00:00Z')).toBe('31/08/2026 às 00:00h')
  })

  it('vira o dia quando o UTC já passou da meia-noite mas Brasília não', () => {
    // 09/09 00:30 UTC = 08/09 21:30 em São Paulo. É o caso que faz o fuso
    // fixo importar: sem ele a mensagem anuncia a reunião no dia seguinte.
    expect(formatarParaMensagem('2026-09-09T00:30:00Z')).toBe('08/09/2026 às 21:30h')
  })

  it('respeita um fuso pedido explicitamente', () => {
    expect(formatarParaMensagem('2026-08-30T19:00:00Z', 'UTC')).toBe('30/08/2026 às 19:00h')
  })

  it('vazio e lixo devolvem string vazia, nunca "Invalid Date"', () => {
    // O campo é TEXT livre: pode ter qualquer coisa digitada antes de virar
    // data. Quem chama decide o que fazer com o vazio (o motor cai no valor
    // cru); o que não pode é "Invalid Date" viajar para o WhatsApp.
    expect(formatarParaMensagem('')).toBe('')
    expect(formatarParaMensagem(null)).toBe('')
    expect(formatarParaMensagem(undefined)).toBe('')
    expect(formatarParaMensagem('amanhã de tarde')).toBe('')
  })

  it('o fuso do escritório é o de São Paulo', () => {
    expect(FUSO_DO_ESCRITORIO).toBe('America/Sao_Paulo')
  })
})

describe('ida e volta do formulário (regressão da convenção)', () => {
  it('o que o input devolve volta a ser o mesmo instante', () => {
    const iso = '2026-08-30T19:00:00.000Z'
    expect(deEntradaLocal(paraEntradaLocal(iso))).toBe(iso)
  })
})

// ------------------------------------------------------------
// O instante numa forma só (a chave da trava do lembrete, 935).
//
// Medido em produção: o campo da reunião era gravado pela automação do
// Calendly ("…:00.000000Z") e, ~1 s depois, pela API v1 ("…:00.000Z"). Como
// a trava é por TEXTO, as duas formas do mesmo horário mandavam o lembrete
// duas vezes.
// ------------------------------------------------------------

describe('instanteCanonico', () => {
  const CANONICO = '2026-09-28T17:30:00.000Z'

  it('CRÍTICO: o mesmo instante em todos os formatos vistos dá o mesmo texto', () => {
    for (const forma of [
      '2026-09-28T17:30:00.000000Z', // a automação do Calendly
      '2026-09-28T17:30:00.000Z', // a API v1 (toISOString)
      '2026-09-28T17:30:00Z',
      '2026-09-28T17:30:00+00:00',
      '2026-09-28 17:30:00+00', // o PostgREST, com espaço
      '2026-09-28 17:30:00.000000+00',
      '2026-09-28T14:30:00-03:00',
      '2026-09-28T14:30:00-0300',
      '2026-09-28T17:30Z', // sem segundos
      '2026-09-28t17:30:00z', // caixa baixa
    ]) {
      expect(instanteCanonico(forma), forma).toBe(CANONICO)
    }
  })

  it('CRÍTICO: as formas que o Date.parse do V8 recusa sozinhas são remontadas', () => {
    // `T…+00` e `-03` sem minutos dão NaN no Node 22 e no 24 (medido).
    expect(instanteCanonico('2026-09-28T17:30:00+00')).toBe(CANONICO)
    expect(instanteCanonico('2026-09-28T14:30:00-03')).toBe(CANONICO)
  })

  it('apara as pontas', () => {
    expect(instanteCanonico('  2026-09-28T17:30:00.000000Z \n')).toBe(CANONICO)
  })

  it('microssegundos são CORTADOS em milissegundos, como o V8 já faz', () => {
    expect(instanteCanonico('2026-09-28T17:30:00.123456Z')).toBe('2026-09-28T17:30:00.123Z')
    expect(instanteCanonico('2026-09-28T17:30:00.5Z')).toBe('2026-09-28T17:30:00.500Z')
  })

  it('instantes diferentes continuam diferentes', () => {
    expect(instanteCanonico('2026-09-28T18:30:00Z')).not.toBe(CANONICO)
    expect(instanteCanonico('2026-09-28T17:30:00-03:00')).toBe('2026-09-28T20:30:00.000Z')
  })

  it('CRÍTICO: sem fuso escrito devolve null — o JS e o Postgres leriam em fusos diferentes', () => {
    expect(instanteCanonico('2026-09-28T17:30:00')).toBeNull()
    expect(instanteCanonico('2026-09-28 17:30')).toBeNull()
    expect(instanteCanonico('2026-09-28')).toBeNull()
  })

  it('o que não é instante devolve null', () => {
    expect(instanteCanonico('30/08/2026 às 16:00h')).toBeNull()
    expect(instanteCanonico('amanhã de tarde')).toBeNull()
    expect(instanteCanonico('2026-13-45T17:30:00Z')).toBeNull()
    expect(instanteCanonico('')).toBeNull()
    expect(instanteCanonico('   ')).toBeNull()
    expect(instanteCanonico(null)).toBeNull()
    expect(instanteCanonico(undefined)).toBeNull()
  })
})
