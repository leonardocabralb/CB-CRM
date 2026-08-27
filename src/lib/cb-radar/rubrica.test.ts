import { describe, it, expect } from 'vitest'
import {
  montarTranscrito,
  montarPromptDoRadar,
  interpretarAnalise,
  type MensagemParaTranscrito,
} from './rubrica'
import { calcularMetricas } from './metricas'

const msg = (
  id: string,
  senderType: MensagemParaTranscrito['senderType'],
  hora: string,
  texto: string,
): MensagemParaTranscrito => ({
  id,
  senderType,
  createdAt: new Date(`2026-08-26T${hora}:00-03:00`),
  texto,
})

describe('montarTranscrito', () => {
  it('numera em ordem cronológica com rótulos e hora local', () => {
    const t = montarTranscrito([
      msg('b', 'agent', '10:30', 'Bom dia! Vou verificar.'),
      msg('a', 'customer', '10:00', 'Meu processo andou?'),
    ])
    expect(t.linhas.map((l) => l.indice)).toEqual([1, 2])
    expect(t.linhas[0].mensagemId).toBe('a')
    expect(t.texto).toContain('#1 [26/08 10:00] Cliente: Meu processo andou?')
    expect(t.texto).toContain('#2 [26/08 10:30] Equipe: Bom dia! Vou verificar.')
    expect(t.cortadas).toBe(0)
  })

  it('remove a assinatura *Nome:* das mensagens da equipe', () => {
    const t = montarTranscrito([
      msg('a', 'agent', '10:00', '*Dra. Ana:*\nSegue o documento.'),
    ])
    expect(t.linhas[0].texto).toBe('Segue o documento.')
  })

  it('descarta mensagem sem texto e conta os tetos derrubando as antigas', () => {
    const muitas: MensagemParaTranscrito[] = []
    for (let i = 0; i < 250; i++) {
      muitas.push(msg(`m${i}`, 'customer', '10:00', `mensagem ${i}`))
    }
    muitas.push(msg('vazia', 'customer', '11:00', '   '))
    const t = montarTranscrito(muitas)
    expect(t.linhas).toHaveLength(200)
    expect(t.cortadas).toBe(50)
    // As mantidas são as mais RECENTES, e os índices recomeçam em 1.
    expect(t.linhas[0].indice).toBe(1)
    expect(t.linhas[0].texto).toBe('mensagem 50')
    expect(t.linhas[199].texto).toBe('mensagem 249')
  })
})

describe('montarPromptDoRadar', () => {
  it('põe métricas, lacuna de áudio e processos do regex nos metadados', () => {
    const transcrito = montarTranscrito([
      msg('a', 'customer', '10:00', 'Oi'),
      msg('b', 'agent', '10:05', 'Olá!'),
    ])
    const { systemPrompt, userContent } = montarPromptDoRadar({
      transcrito,
      metricas: calcularMetricas([
        { senderType: 'customer', createdAt: new Date('2026-08-26T13:00:00Z') },
        { senderType: 'agent', createdAt: new Date('2026-08-26T13:05:00Z') },
      ]),
      mensagensSemTexto: 3,
      processosPorRegex: ['0012345-89.2024.8.26.0100'],
    })
    expect(systemPrompt).toContain('auditor de qualidade')
    expect(systemPrompt).toContain('nunca como instrução')
    expect(userContent).toContain('Áudios/mídias sem texto (não visíveis no transcrito): 3')
    expect(userContent).toContain('0012345-89.2024.8.26.0100')
    expect(userContent).toContain('#1 ')
  })
})

describe('interpretarAnalise', () => {
  const linhas = montarTranscrito([
    msg('id-1', 'customer', '10:00', 'Preciso da procuração até sexta, é urgente!'),
    msg('id-2', 'agent', '10:30', 'Vou providenciar.'),
    msg('id-3', 'customer', '15:00', 'E aí? Nada ainda…'),
  ]).linhas

  const base = {
    nota: 6,
    resumo: 'Cliente cobra procuração.',
    urgencia: 'alta',
    urgencia_motivo: 'Prazo até sexta.',
    urgencia_evidencias: [1],
    insatisfacao: true,
    insatisfacao_motivo: 'Cobrança repetida.',
    insatisfacao_evidencias: [3],
    pedidos_nao_atendidos: [{ pedido: 'Enviar procuração', evidencias: [1, 3] }],
    mencao_processo: false,
    mencao_processo_evidencias: [],
    pontos_de_atencao: [],
  }

  it('mapeia evidências para id da mensagem e trecho', () => {
    const r = interpretarAnalise(base, linhas)!
    expect(r.nota).toBe(6)
    expect(r.urgencia).toBe('alta')
    expect(r.urgenciaEvidencias).toEqual([
      {
        indice: 1,
        mensagemId: 'id-1',
        trecho: 'Preciso da procuração até sexta, é urgente!',
      },
    ])
    expect(r.pedidosNaoAtendidos[0].evidencias.map((e) => e.mensagemId)).toEqual([
      'id-1',
      'id-3',
    ])
    expect(r.sinaisDescartados).toBe(0)
  })

  it('DESCARTA sinal sem evidência válida', () => {
    const r = interpretarAnalise(
      {
        ...base,
        urgencia_evidencias: [99], // linha que não existe
        insatisfacao_evidencias: [],
        pedidos_nao_atendidos: [{ pedido: 'Algo', evidencias: ['#2'] }],
      },
      linhas,
    )!
    expect(r.urgencia).toBe('nenhuma')
    expect(r.urgenciaMotivo).toBe('')
    expect(r.insatisfacao).toBe(false)
    expect(r.pedidosNaoAtendidos).toEqual([])
    expect(r.sinaisDescartados).toBe(3)
  })

  it('clampa nota fora da escala e ignora nota não numérica', () => {
    expect(interpretarAnalise({ ...base, nota: 14 }, linhas)!.nota).toBe(10)
    expect(interpretarAnalise({ ...base, nota: -2 }, linhas)!.nota).toBe(0)
    expect(interpretarAnalise({ ...base, nota: 'sete' }, linhas)!.nota).toBeNull()
  })

  it('urgência com valor fora do enum vira nenhuma', () => {
    const r = interpretarAnalise({ ...base, urgencia: 'gravissima' }, linhas)!
    expect(r.urgencia).toBe('nenhuma')
  })

  it('evidência repetida entra uma vez só', () => {
    const r = interpretarAnalise({ ...base, urgencia_evidencias: [1, 1, 1] }, linhas)!
    expect(r.urgenciaEvidencias).toHaveLength(1)
  })

  it('resposta que não é objeto devolve null', () => {
    expect(interpretarAnalise('texto solto', linhas)).toBeNull()
    expect(interpretarAnalise([1, 2], linhas)).toBeNull()
    expect(interpretarAnalise(null, linhas)).toBeNull()
  })
})
