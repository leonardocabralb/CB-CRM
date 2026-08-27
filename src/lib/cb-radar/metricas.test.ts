import { describe, it, expect } from 'vitest'
import { calcularMetricas, type MensagemParaMetricas } from './metricas'

// Quarta-feira, dentro do expediente (SP = UTC-3).
const em = (hora: string): Date => new Date(`2026-08-26T${hora}:00-03:00`)
const cliente = (hora: string): MensagemParaMetricas => ({
  senderType: 'customer',
  createdAt: em(hora),
})
const equipe = (hora: string): MensagemParaMetricas => ({
  senderType: 'agent',
  createdAt: em(hora),
})

describe('calcularMetricas', () => {
  it('mede pergunta→resposta e conta os lados', () => {
    const r = calcularMetricas([cliente('10:00'), equipe('10:30')])
    expect(r.primeiraRespostaSeg).toBe(30 * 60)
    expect(r.respostaMedianaSeg).toBe(30 * 60)
    expect(r.aguardandoDesde).toBeNull()
    expect(r.msgsCliente).toBe(1)
    expect(r.msgsEquipe).toBe(1)
  })

  it('sequência do cliente conta desde a PRIMEIRA mensagem', () => {
    const r = calcularMetricas([cliente('10:00'), cliente('10:40'), equipe('11:00')])
    expect(r.primeiraRespostaSeg).toBe(60 * 60)
  })

  it('cliente falou por último = pendência aberta desde a primeira sem resposta', () => {
    const r = calcularMetricas([
      cliente('10:00'),
      equipe('10:10'),
      cliente('14:00'),
      cliente('15:00'),
    ])
    expect(r.aguardandoDesde).toEqual(em('14:00'))
    expect(r.respostaMedianaSeg).toBe(10 * 60)
  })

  it('mediana com número par de rodadas é a média das centrais', () => {
    const r = calcularMetricas([
      cliente('09:00'),
      equipe('09:10'), // 10min
      cliente('10:00'),
      equipe('10:30'), // 30min
    ])
    expect(r.respostaMedianaSeg).toBe(20 * 60)
  })

  it('mensagem fora de ordem é reordenada antes de medir', () => {
    const r = calcularMetricas([equipe('10:30'), cliente('10:00')])
    expect(r.primeiraRespostaSeg).toBe(30 * 60)
  })

  it('resposta "antes" da pergunta (relógio torto) mede zero, não negativo', () => {
    // Entrada carimba o relógio do aparelho; saída carimba o do banco.
    const r = calcularMetricas([
      { senderType: 'customer', createdAt: em('10:00') },
      { senderType: 'agent', createdAt: em('10:00') },
    ])
    expect(r.primeiraRespostaSeg).toBe(0)
  })

  it('equipe falando sozinha não gera métrica nem pendência', () => {
    const r = calcularMetricas([equipe('10:00'), equipe('11:00')])
    expect(r.primeiraRespostaSeg).toBeNull()
    expect(r.respostaMedianaSeg).toBeNull()
    expect(r.aguardandoDesde).toBeNull()
  })

  it('bot responde como equipe', () => {
    const r = calcularMetricas([
      cliente('10:00'),
      { senderType: 'bot', createdAt: em('10:05') },
    ])
    expect(r.primeiraRespostaSeg).toBe(5 * 60)
    expect(r.msgsEquipe).toBe(1)
  })
})
