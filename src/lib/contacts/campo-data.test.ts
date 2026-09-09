import { describe, it, expect } from 'vitest'
import {
  FUSO_DO_ESCRITORIO,
  formatarParaMensagem,
  paraEntradaLocal,
  deEntradaLocal,
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
