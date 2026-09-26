import { describe, it, expect } from 'vitest'
import { calcularMetricas, type MensagemParaMetricas } from './metricas'

// Quarta-feira, dentro do expediente (SP = UTC-3).
const em = (hora: string): Date => new Date(`2026-08-26T${hora}:00-03:00`)
const cliente = (hora: string): MensagemParaMetricas => ({
  senderType: 'customer',
  porGente: false,
  createdAt: em(hora),
})
/** Alguém do escritório digitou — no CRM ou no celular pareado. */
const equipe = (hora: string): MensagemParaMetricas => ({
  senderType: 'agent',
  porGente: true,
  createdAt: em(hora),
})
/** Broadcast, automação, fluxo ou agendada: sai sem gente atrás. */
const automatica = (
  hora: string,
  senderType: 'agent' | 'bot' = 'agent',
): MensagemParaMetricas => ({
  senderType,
  porGente: false,
  createdAt: em(hora),
})

/** Resposta de um agente de IA: `bot` com `ia_agente_id` (D11). */
const ia = (hora: string): MensagemParaMetricas => ({
  senderType: 'bot',
  porGente: false,
  porAgenteDeIa: true,
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
    const r = calcularMetricas([cliente('10:00'), equipe('10:00')])
    expect(r.primeiraRespostaSeg).toBe(0)
  })

  it('equipe falando sozinha não gera métrica nem pendência', () => {
    const r = calcularMetricas([equipe('10:00'), equipe('11:00')])
    expect(r.primeiraRespostaSeg).toBeNull()
    expect(r.respostaMedianaSeg).toBeNull()
    expect(r.aguardandoDesde).toBeNull()
  })

  it('⚠️ saída AUTOMÁTICA não fecha a pendência do cliente', () => {
    // Cliente escreve na segunda e ninguém responde; na terça um broadcast
    // (ou uma automação, um fluxo, uma agendada) entra na conversa. Pelo
    // tipo do remetente sozinho, aquilo fechava a pendência e o cartão do
    // cliente esquecido sumia do painel — apagando o alarme que o Radar
    // existe para acender. Vale para 'agent' sem gente e para 'bot'.
    for (const tipo of ['agent', 'bot'] as const) {
      const r = calcularMetricas([cliente('10:00'), automatica('10:05', tipo)])
      expect(r.aguardandoDesde).toEqual(em('10:00'))
      expect(r.primeiraRespostaSeg).toBeNull()
      // Continua contando como mensagem que SAIU: é volume, não atendimento.
      expect(r.msgsEquipe).toBe(1)
    }
  })

  it('a resposta de gente DEPOIS do robô fecha a pendência, medindo desde o cliente', () => {
    const r = calcularMetricas([
      cliente('10:00'),
      automatica('10:05', 'bot'),
      equipe('10:30'),
    ])
    expect(r.aguardandoDesde).toBeNull()
    expect(r.primeiraRespostaSeg).toBe(30 * 60)
    expect(r.msgsEquipe).toBe(2)
  })

  describe('resposta do AGENTE DE IA (D11): fecha a pendência, não entra no tempo da equipe', () => {
    it('a IA respondendo fecha a pendência, sem medir tempo de resposta', () => {
      const r = calcularMetricas([cliente('10:00'), ia('10:00')])
      expect(r.aguardandoDesde).toBeNull()
      // A IA responde em segundos: medida, ela diria que o escritório
      // atende na hora. Rodada que só a IA fechou não é par da equipe.
      expect(r.primeiraRespostaSeg).toBeNull()
      expect(r.respostaMedianaSeg).toBeNull()
      // Volume é volume: a mensagem saiu.
      expect(r.msgsEquipe).toBe(1)
    })

    it('a mediana da equipe ignora as rodadas que a IA fechou', () => {
      const r = calcularMetricas([
        cliente('09:00'),
        ia('09:01'), // fechada pela IA — fora da mediana
        cliente('10:00'),
        equipe('10:40'), // 40 min de gente
        cliente('11:00'),
        ia('11:00'), // fechada pela IA — fora da mediana
      ])
      expect(r.respostaMedianaSeg).toBe(40 * 60)
      expect(r.primeiraRespostaSeg).toBe(40 * 60)
      expect(r.aguardandoDesde).toBeNull()
    })

    it('depois da IA, a rodada que a pessoa assume mede desde a fala seguinte do cliente', () => {
      // O cliente pede um advogado depois da resposta da IA; a transferência
      // não manda mensagem (E7) e a pessoa responde às 11:00. O tempo da
      // equipe conta das 10:05, não das 10:00 que a IA já respondeu.
      const r = calcularMetricas([
        cliente('10:00'),
        ia('10:01'),
        cliente('10:05'),
        equipe('11:00'),
      ])
      expect(r.primeiraRespostaSeg).toBe(55 * 60)
      expect(r.aguardandoDesde).toBeNull()
    })

    it('cliente que volta a escrever depois da IA reabre a pendência', () => {
      const r = calcularMetricas([cliente('10:00'), ia('10:01'), cliente('14:00')])
      expect(r.aguardandoDesde).toEqual(em('14:00'))
    })

    it('⚠️ robô SEM `ia_agente_id` (fluxo, automação) continua não fechando', () => {
      // O mesmo `sender_type = 'bot'` da IA: quem separa os dois é o
      // `porAgenteDeIa`, que o chamador só liga com a coluna preenchida.
      const r = calcularMetricas([cliente('10:00'), automatica('10:01', 'bot')])
      expect(r.aguardandoDesde).toEqual(em('10:00'))
    })

    it('`porAgenteDeIa` AUSENTE conta como falso — o lado do alarme', () => {
      const semOCampo: MensagemParaMetricas = {
        senderType: 'bot',
        porGente: false,
        createdAt: em('10:01'),
      }
      const r = calcularMetricas([cliente('10:00'), semOCampo])
      expect(r.aguardandoDesde).toEqual(em('10:00'))
    })

    it('mensagem da IA sem pendência aberta não mexe em nada', () => {
      const r = calcularMetricas([ia('09:00'), cliente('10:00'), equipe('10:30')])
      expect(r.primeiraRespostaSeg).toBe(30 * 60)
      expect(r.msgsEquipe).toBe(2)
    })
  })
})
