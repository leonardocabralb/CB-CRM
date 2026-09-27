import { describe, expect, it } from 'vitest'

import type { PerguntaDoTipoDeEvento } from '@/lib/calendly/cliente'
import { lerAgendamento } from '@/lib/calendly/payload'

import {
  ANTECEDENCIA_DOS_HORARIOS_MS,
  corpoDoConvidado,
  dataHoraDaReuniao,
  HORARIOS_POR_DIA,
  janelaDosHorarios,
  JANELA_DOS_HORARIOS_MS,
  opcoesDeHorario,
  recusaDoHorario,
  respostasDoTelefone,
  TETO_DE_HORARIOS,
  textoDoHorario,
} from './reuniao'

// ============================================================
// A reunião que o agente marca (F5). O que estes testes seguram:
//  - a janela: de agora + 1 h, NUNCA mais de 7 dias (o Calendly recusa);
//  - o horário no FUSO DO ESCRITÓRIO (o contêiner roda em UTC): para o
//    MODELO com o dia da semana ("Mon 28/09 15:15", `textoNoPedido`), para
//    GENTE sem ele ("28/09/2026 15:15", o `nome`), e o ISO em UTC como `id`;
//  - uma AMOSTRA espalhada: até 3 por dia, 15 no total, cobrindo os dias;
//  - o corpo do `POST /invitees` num ponto só (a medição ajusta aqui), com o
//    telefone na pergunta do formulário que o NOSSO webhook lê;
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
  it('em ordem, sem repetição, com o ISO em UTC como id; `nome` para gente, `textoNoPedido` para o modelo; ilegível fica de fora', () => {
    const opcoes = opcoesDeHorario([
      '2026-09-29T13:00:00Z',
      '2026-09-28T18:15:00Z',
      '2026-09-28T18:15:00.000Z',
      'amanhã',
    ])
    expect(opcoes).toEqual([
      { id: '2026-09-28T18:15:00.000Z', nome: '28/09/2026 15:15', textoNoPedido: 'Mon 28/09 15:15' },
      { id: '2026-09-29T13:00:00.000Z', nome: '29/09/2026 10:00', textoNoPedido: 'Tue 29/09 10:00' },
    ])
    // O que gente lê (o registro do turno, o Playground, a anotação) não tem o dia da semana em inglês.
    expect(opcoes.map((o) => o.nome).join(' ')).not.toMatch(/Mon|Tue/)
  })

  it('⚠️ uma AMOSTRA espalhada: até 3 por dia (o primeiro, o do meio e o último), 15 no total, cobrindo TODOS os dias', () => {
    // 7 dias, das 9h às 17h30 (Brasília) de meia em meia hora: 18 horários por dia.
    const inicios: string[] = []
    for (let dia = 0; dia < 7; dia++) {
      for (let meia = 0; meia < 18; meia++) {
        inicios.push(new Date(Date.UTC(2026, 8, 28 + dia, 12) + meia * 30 * 60_000).toISOString())
      }
    }
    const opcoes = opcoesDeHorario(inicios)
    expect(opcoes).toHaveLength(TETO_DE_HORARIOS)
    const porDia = new Map<string, string[]>()
    for (const o of opcoes) {
      const [dia, hora] = o.nome.split(' ')
      porDia.set(dia, [...(porDia.get(dia) ?? []), hora])
    }
    // Todos os 7 dias entram, nenhum passa de 3.
    expect(porDia.size).toBe(7)
    expect(Math.max(...[...porDia.values()].map((h) => h.length))).toBeLessThanOrEqual(HORARIOS_POR_DIA)
    // Espalhados pelo dia: a manhã E a tarde, nunca três seguidos da manhã.
    expect(porDia.get('28/09/2026')).toEqual(['09:00', '13:30', '17:30'])
    expect(porDia.get('29/09/2026')).toEqual(['09:00', '17:30'])
    // Em ordem.
    expect(opcoes.map((o) => o.id)).toEqual([...opcoes.map((o) => o.id)].sort())
  })

  it('poucos dias com vaga: até 3 de cada, e não passa disso só porque sobra teto', () => {
    const inicios = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 8, 28, 12) + i * 30 * 60_000).toISOString())
    const opcoes = opcoesDeHorario(inicios)
    expect(opcoes).toHaveLength(HORARIOS_POR_DIA)
    expect(opcoes.map((o) => o.textoNoPedido)).toEqual(['Mon 28/09 09:00', 'Mon 28/09 14:00', 'Mon 28/09 18:30'])
  })

  it('o DIA é o do escritório: 23:30 de Brasília (02:30 UTC do dia seguinte) é do dia anterior', () => {
    const opcoes = opcoesDeHorario(['2026-09-29T02:30:00Z', '2026-09-28T13:00:00Z', '2026-09-28T15:00:00Z', '2026-09-28T20:00:00Z'])
    // Quatro no mesmo dia de Brasília: o primeiro, o último (23:30) e o do meio.
    expect(opcoes.map((o) => o.nome)).toEqual(['28/09/2026 10:00', '28/09/2026 17:00', '28/09/2026 23:30'])
  })
})

describe('respostasDoTelefone — a pergunta que o NOSSO webhook lê', () => {
  const TELEFONE = '+5583980000016'
  const p = (nome: string, extra: Partial<PerguntaDoTipoDeEvento> = {}): PerguntaDoTipoDeEvento => ({
    nome,
    tipo: 'string',
    obrigatoria: false,
    posicao: 0,
    ativa: true,
    ...extra,
  })
  // A forma MEDIDA em produção (26/09/2026).
  const MEDIDA = p('Telefone (Whatsapp)', { tipo: 'phone_number', obrigatoria: true, posicao: 0 })

  it('⚠️ a pergunta de tipo `phone_number` (a medida): respondida com o telefone em E.164, na forma da Scheduling API', () => {
    expect(respostasDoTelefone([MEDIDA], TELEFONE)).toEqual([
      { question: 'Telefone (Whatsapp)', answer: TELEFONE, position: 0 },
    ])
  })

  it('a pergunta CONFIGURADA no cartão (`pergunta_telefone`), pela régua do webhook — mesmo com rótulo que a heurística não reconhece', () => {
    const perguntas = [p('Empresa', { posicao: 0 }), p('Número para falarmos', { posicao: 1 })]
    expect(respostasDoTelefone(perguntas, TELEFONE, 'numero para')).toEqual([
      { question: 'Número para falarmos', answer: TELEFONE, position: 1 },
    ])
  })

  it('sem `phone_number` nem configurada: a PRIMEIRA cujo rótulo fala de telefone (a heurística do webhook)', () => {
    const perguntas = [p('Empresa', { posicao: 0 }), p('Seu WhatsApp', { posicao: 1 }), p('Telefone fixo', { posicao: 2 })]
    expect(respostasDoTelefone(perguntas, TELEFONE)).toEqual([{ question: 'Seu WhatsApp', answer: TELEFONE, position: 1 }])
  })

  it('não se inventa resposta: nenhuma pergunta de telefone, pergunta desligada, de seleção, ou sem telefone = nada', () => {
    expect(respostasDoTelefone([p('Empresa'), p('Assunto', { tipo: 'text' })], TELEFONE)).toEqual([])
    expect(respostasDoTelefone([{ ...MEDIDA, ativa: false }], TELEFONE)).toEqual([])
    expect(respostasDoTelefone([p('Telefone', { tipo: 'single_select' })], TELEFONE)).toEqual([])
    expect(respostasDoTelefone([MEDIDA], null)).toEqual([])
  })

  it('a configurada E a `phone_number` (as duas): as duas respondidas, em ordem de posição, sem repetir', () => {
    const perguntas = [p('Celular do responsável', { posicao: 2 }), { ...MEDIDA, posicao: 1 }]
    expect(respostasDoTelefone(perguntas, TELEFONE, 'Telefone (Whatsapp)')).toEqual([
      { question: 'Telefone (Whatsapp)', answer: TELEFONE, position: 1 },
    ])
    expect(respostasDoTelefone(perguntas, TELEFONE, 'responsavel')).toEqual([
      { question: 'Telefone (Whatsapp)', answer: TELEFONE, position: 1 },
      { question: 'Celular do responsável', answer: TELEFONE, position: 2 },
    ])
  })

  it('⚠️ fecha o ciclo: o `invitee.created` com essas respostas é achado pelo telefone no NOSSO webhook', () => {
    const casos: Array<[PerguntaDoTipoDeEvento[], string | null]> = [
      [[MEDIDA], null],
      [[p('Empresa', { posicao: 0 }), p('Número para falarmos', { posicao: 1 })], 'numero para'],
      [[p('Seu WhatsApp')], null],
    ]
    for (const [perguntas, configurada] of casos) {
      const corpo = {
        event: 'invitee.created',
        payload: {
          uri: 'https://api.calendly.com/scheduled_events/E1/invitees/I1',
          name: 'Maria',
          // Sem SMS: o tipo de evento não pede lembrete por SMS, e o Calendly não guarda o número.
          questions_and_answers: respostasDoTelefone(perguntas, TELEFONE, configurada),
        },
      }
      expect(lerAgendamento(corpo, { perguntaTelefone: configurada })?.telefone).toBe('5583980000016')
    }
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

  it('⚠️ o telefone também vai como RESPOSTA da pergunta de telefone do formulário (é por ela que o webhook acha o cliente)', () => {
    const corpo = corpoDoConvidado({
      ...base,
      perguntas: [{ nome: 'Telefone (Whatsapp)', tipo: 'phone_number', obrigatoria: true, posicao: 0, ativa: true }],
    })
    expect(corpo.questions_and_answers).toEqual([{ question: 'Telefone (Whatsapp)', answer: '+5511999998888', position: 0 }])
    // O lembrete por SMS continua.
    expect((corpo.invitee as Record<string, unknown>).text_reminder_number).toBe('+5511999998888')
    // A configurada no cartão chega à régua.
    const configurada = corpoDoConvidado({
      ...base,
      perguntas: [{ nome: 'Contato para a reunião', tipo: 'string', obrigatoria: false, posicao: 3, ativa: true }],
      perguntaTelefone: 'contato para',
    })
    expect(configurada.questions_and_answers).toEqual([{ question: 'Contato para a reunião', answer: '+5511999998888', position: 3 }])
  })

  it('pergunta OBRIGATÓRIA que não é de telefone fica SEM resposta (o POST falha e o turno transfere — nunca inventar)', () => {
    const corpo = corpoDoConvidado({
      ...base,
      perguntas: [{ nome: 'Qual o número do processo?', tipo: 'string', obrigatoria: true, posicao: 0, ativa: true }],
    })
    expect(corpo).not.toHaveProperty('questions_and_answers')
  })

  it('o nome completo que o cliente deu (`nomeInformado`, do `[[REUNIAO:n=Nome]]`) vence o da ficha; fora da forma, fica o da ficha', () => {
    const invitee = (d: Partial<typeof base> & { nomeInformado?: string | null }) =>
      corpoDoConvidado({ ...base, ...d }).invitee as Record<string, unknown>
    expect(invitee({ nomeInformado: '  Maria   Aparecida Souza ' }).name).toBe('Maria Aparecida Souza')
    expect(invitee({ nomeInformado: null }).name).toBe('Maria Souza')
    expect(invitee({ nomeInformado: 'x' }).name).toBe('Maria Souza')
    expect(invitee({ nomeInformado: '12345' }).name).toBe('Maria Souza')
    expect(invitee({ nomeInformado: 'a'.repeat(121) }).name).toBe('Maria Souza')
    // Sem nome na ficha (o telefone) e com o nome dado: o dado.
    expect(invitee({ nome: '5511999998888', nomeInformado: 'João da Silva' }).name).toBe('João da Silva')
  })

  it('sem telefone válido, sem o lembrete por SMS; sem local, sem `location`', () => {
    const corpo = corpoDoConvidado({ ...base, telefone: null, local: null })
    expect(corpo).not.toHaveProperty('location')
    expect((corpo.invitee as Record<string, unknown>).text_reminder_number).toBeUndefined()
    const lixo = corpoDoConvidado({
      ...base,
      telefone: '0123',
      perguntas: [{ nome: 'Telefone (Whatsapp)', tipo: 'phone_number', obrigatoria: true, posicao: 0, ativa: true }],
    })
    expect((lixo.invitee as Record<string, unknown>).text_reminder_number).toBeUndefined()
    expect(lixo).not.toHaveProperty('questions_and_answers')
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
