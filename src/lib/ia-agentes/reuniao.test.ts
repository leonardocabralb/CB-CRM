import { describe, expect, it } from 'vitest'

import {
  ANTECEDENCIA_DOS_HORARIOS_MS,
  corpoDoConvidado,
  dataHoraDaReuniao,
  janelaDosHorarios,
  JANELA_DOS_HORARIOS_MS,
  opcoesDeHorario,
  recusaDoHorario,
  TETO_DE_HORARIOS,
  textoDoHorario,
} from './reuniao'

// ============================================================
// A reunião que o agente marca (F5). O que estes testes seguram:
//  - a janela: de agora + 1 h, NUNCA mais de 7 dias (o Calendly recusa);
//  - o horário no FUSO DO ESCRITÓRIO (o contêiner roda em UTC), com o dia da
//    semana — "Mon 28/09 15:15" —, e o ISO em UTC como `id`;
//  - os 12 mais PRÓXIMOS, sem repetição, em ordem;
//  - o corpo do `POST /invitees` num ponto só (a medição ajusta aqui);
//  - a recusa de horário tomado separada das outras.
// ============================================================

describe('janelaDosHorarios', () => {
  it('começa em agora + 1 h e cabe em 7 dias', () => {
    const agora = new Date('2026-09-26T12:00:00Z')
    const { inicio, fim } = janelaDosHorarios(agora)
    expect(inicio).toBe('2026-09-26T13:00:00.000Z')
    expect(Date.parse(inicio) - agora.getTime()).toBe(ANTECEDENCIA_DOS_HORARIOS_MS)
    expect(Date.parse(fim) - Date.parse(inicio)).toBe(JANELA_DOS_HORARIOS_MS)
    expect(Date.parse(fim) - Date.parse(inicio)).toBeLessThanOrEqual(7 * 24 * 60 * 60_000)
  })
})

describe('textoDoHorario / dataHoraDaReuniao — o fuso do escritório', () => {
  it('18:15 UTC de 28/09/2026 (segunda) = "Mon 28/09 15:15" em São Paulo', () => {
    expect(textoDoHorario('2026-09-28T18:15:00Z')).toBe('Mon 28/09 15:15')
    // Madrugada em UTC ainda é o dia ANTERIOR no Brasil.
    expect(textoDoHorario('2026-09-29T02:30:00Z')).toBe('Mon 28/09 23:30')
    expect(textoDoHorario('lixo')).toBeNull()
  })

  it('a anotação: "28/09/2026 15:15"', () => {
    expect(dataHoraDaReuniao('2026-09-28T18:15:00Z')).toBe('28/09/2026 15:15')
    // Meia-noite sai 00, nunca 24.
    expect(dataHoraDaReuniao('2026-09-29T03:00:00Z')).toBe('29/09/2026 00:00')
  })
})

describe('opcoesDeHorario', () => {
  it('em ordem, sem repetição, com o ISO em UTC como id; ilegível fica de fora', () => {
    const opcoes = opcoesDeHorario([
      '2026-09-29T13:00:00Z',
      '2026-09-28T18:15:00Z',
      '2026-09-28T18:15:00.000Z',
      'amanhã',
    ])
    expect(opcoes).toEqual([
      { id: '2026-09-28T18:15:00.000Z', nome: 'Mon 28/09 15:15' },
      { id: '2026-09-29T13:00:00.000Z', nome: 'Tue 29/09 10:00' },
    ])
  })

  it('no máximo os 12 mais PRÓXIMOS', () => {
    const inicios = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 8, 28, 12) + (19 - i) * 30 * 60_000).toISOString())
    const opcoes = opcoesDeHorario(inicios)
    expect(opcoes).toHaveLength(TETO_DE_HORARIOS)
    expect(opcoes[0].id).toBe('2026-09-28T12:00:00.000Z')
    expect(opcoes.at(-1)?.id).toBe('2026-09-28T17:30:00.000Z')
  })
})

describe('corpoDoConvidado — o corpo do POST /invitees, num ponto só', () => {
  const base = {
    tipoDeEvento: 'https://api.calendly.com/event_types/T1',
    inicio: '2026-09-28T18:15:00.000Z',
    nome: 'Maria Souza',
    email: 'maria@exemplo.com',
    telefone: '5511999998888',
    local: 'google_conference',
  }

  it('a forma da documentação: tipo, início, convidado (fuso do escritório, telefone com +) e o local', () => {
    expect(corpoDoConvidado(base)).toEqual({
      event_type: 'https://api.calendly.com/event_types/T1',
      start_time: '2026-09-28T18:15:00.000Z',
      invitee: {
        name: 'Maria Souza',
        email: 'maria@exemplo.com',
        timezone: 'America/Sao_Paulo',
        text_reminder_number: '+5511999998888',
      },
      location: { kind: 'google_conference' },
    })
  })

  it('sem telefone válido, sem o lembrete por SMS; sem local, sem `location`', () => {
    const corpo = corpoDoConvidado({ ...base, telefone: null, local: null })
    expect(corpo).not.toHaveProperty('location')
    expect((corpo.invitee as Record<string, unknown>).text_reminder_number).toBeUndefined()
    const lixo = corpoDoConvidado({ ...base, telefone: '0123' })
    expect((lixo.invitee as Record<string, unknown>).text_reminder_number).toBeUndefined()
  })
})

describe('recusaDoHorario', () => {
  it('409 ou 4xx que fala do horário = horário indisponível; o resto, recusado', () => {
    expect(recusaDoHorario(409, '409: Conflict')).toBe('horario_indisponivel')
    expect(recusaDoHorario(400, '400: The selected time is no longer available')).toBe('horario_indisponivel')
    expect(recusaDoHorario(422, '422: That time slot is unavailable')).toBe('horario_indisponivel')
    expect(recusaDoHorario(400, '400: invitee.email is invalid')).toBe('recusado')
    expect(recusaDoHorario(500, '500: The selected time is no longer available')).toBe('recusado')
    expect(recusaDoHorario(null, 'rede')).toBe('recusado')
  })
})
