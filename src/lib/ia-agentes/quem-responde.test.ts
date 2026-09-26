import { describe, expect, it } from 'vitest'

import {
  abreTurno,
  MIME_DA_FIGURINHA,
  PREFIXO_DE_TIPO_NAO_SUPORTADO,
  quemResponde,
  TIPOS_QUE_ABREM_TURNO,
  type FatosDaMensagem,
} from './quem-responde'

const CANAL = 'canal-a'
const LIGADO_EM = '2026-09-25T10:00:00Z'
const AGENTE = {
  id: 'cobranca',
  ativo: true,
  arquivado: false,
  conexoes: [CANAL],
  ativadoEm: LIGADO_EM,
  desde: '2026-09-25T10:30:00Z',
}
const CARD = { id: 'deal-1', stageId: 'etapa-cobranca', pipelineId: 'funil-1', etapaDesde: '2026-09-25T11:00:00Z' }

function fatos(p: Partial<FatosDaMensagem> = {}): FatosDaMensagem {
  return {
    ehGrupo: false,
    ehInstagram: false,
    canalId: CANAL,
    conteudo: { tipo: 'text', texto: 'Oi', mime: null },
    ehRespostaDeBotao: false,
    roboConsumiu: false,
    automacaoFalou: false,
    encerrada: false,
    pausada: false,
    card: CARD,
    agente: AGENTE,
    ...p,
  }
}

describe('quemResponde — a ordem das regras (D24–D27)', () => {
  it('card na etapa do agente, que entrou DEPOIS de o agente ser ligado nela: o agente da etapa responde, com o card e a etapa', () => {
    expect(quemResponde(fatos())).toEqual({
      quem: 'agente',
      agenteId: 'cobranca',
      dealId: 'deal-1',
      stageId: 'etapa-cobranca',
    })
  })

  it('D27: card ANTIGO (entrou na etapa antes de a etapa ser do agente) não é atendido', () => {
    expect(quemResponde(fatos({ card: { ...CARD, etapaDesde: '2026-09-25T10:15:00Z' } }))).toEqual({
      quem: 'ninguem',
      motivo: 'card_antigo',
    })
  })

  it('D27: agente religado DEPOIS de o card entrar na etapa: o card é antigo para ele', () => {
    const religado = { ...AGENTE, ativadoEm: '2026-09-25T12:00:00Z' }
    expect(quemResponde(fatos({ agente: religado }))).toEqual({ quem: 'ninguem', motivo: 'card_antigo' })
  })

  it('D27: sem uma das datas, NÃO atende (o lado que atende menos gente)', () => {
    expect(quemResponde(fatos({ card: { ...CARD, etapaDesde: null } })).quem).toBe('ninguem')
    expect(quemResponde(fatos({ agente: { ...AGENTE, ativadoEm: null } })).quem).toBe('ninguem')
    expect(quemResponde(fatos({ agente: { ...AGENTE, desde: null } })).quem).toBe('ninguem')
  })

  it('no mesmo instante vale (maior OU IGUAL)', () => {
    expect(quemResponde(fatos({ card: { ...CARD, etapaDesde: AGENTE.desde } })).quem).toBe('agente')
  })

  it('sem card aberto: ninguém', () => {
    expect(quemResponde(fatos({ card: null }))).toEqual({ quem: 'ninguem', motivo: 'sem_card' })
  })

  it('etapa sem agente: ninguém', () => {
    expect(quemResponde(fatos({ agente: null }))).toEqual({ quem: 'ninguem', motivo: 'etapa_sem_agente' })
  })

  it('agente desligado ou arquivado: ninguém', () => {
    expect(quemResponde(fatos({ agente: { ...AGENTE, ativo: false } }))).toEqual({
      quem: 'ninguem',
      motivo: 'agente_desligado',
    })
    expect(quemResponde(fatos({ agente: { ...AGENTE, arquivado: true } }))).toEqual({
      quem: 'ninguem',
      motivo: 'agente_desligado',
    })
  })

  it('a mensagem veio por uma conexão que NÃO é do agente: ninguém', () => {
    expect(quemResponde(fatos({ canalId: 'canal-b' }))).toEqual({ quem: 'ninguem', motivo: 'fora_da_conexao' })
  })

  it('robô, automação que falou, encerrada e pausada calam — nesta ordem, antes do card', () => {
    expect(quemResponde(fatos({ roboConsumiu: true, automacaoFalou: true }))).toEqual({ quem: 'ninguem', motivo: 'robo' })
    expect(quemResponde(fatos({ automacaoFalou: true, pausada: true }))).toEqual({
      quem: 'ninguem',
      motivo: 'automacao_falou',
    })
    expect(quemResponde(fatos({ encerrada: true, pausada: true }))).toEqual({ quem: 'ninguem', motivo: 'encerrada' })
    expect(quemResponde(fatos({ pausada: true, card: null }))).toEqual({ quem: 'ninguem', motivo: 'pausada' })
  })

  it('fora do alcance: grupo, Instagram, sem conexão', () => {
    expect(quemResponde(fatos({ ehGrupo: true }))).toEqual({ quem: 'ninguem', motivo: 'fora_do_alcance' })
    expect(quemResponde(fatos({ ehInstagram: true }))).toEqual({ quem: 'ninguem', motivo: 'fora_do_alcance' })
    expect(quemResponde(fatos({ canalId: null }))).toEqual({ quem: 'ninguem', motivo: 'fora_do_alcance' })
  })

  it('não abre turno: toque em botão, figurinha e localização', () => {
    expect(quemResponde(fatos({ ehRespostaDeBotao: true }))).toEqual({ quem: 'ninguem', motivo: 'nao_abre_turno' })
    expect(
      quemResponde(fatos({ conteudo: { tipo: 'image', texto: null, mime: MIME_DA_FIGURINHA } })),
    ).toEqual({ quem: 'ninguem', motivo: 'nao_abre_turno' })
    expect(quemResponde(fatos({ conteudo: { tipo: 'location', texto: null, mime: null } }))).toEqual({
      quem: 'ninguem',
      motivo: 'nao_abre_turno',
    })
  })

  it('áudio, imagem, documento e vídeo abrem turno (E9)', () => {
    for (const tipo of ['audio', 'image', 'document', 'video']) {
      expect(quemResponde(fatos({ conteudo: { tipo, texto: null, mime: null } })).quem, tipo).toBe('agente')
    }
  })
})

describe('abreTurno — a régua do conteúdo (a entrada e o turno usam a mesma)', () => {
  it('vídeo está entre os tipos que abrem turno (E9)', () => {
    expect(TIPOS_QUE_ABREM_TURNO.has('video')).toBe(true)
  })

  it.each([
    ['texto', { tipo: 'text', texto: 'Oi', mime: null }],
    ['foto sem legenda', { tipo: 'image', texto: null, mime: 'image/jpeg' }],
    ['foto ainda sem MIME (a Evolution grava no download)', { tipo: 'image', texto: null, mime: null }],
    ['áudio', { tipo: 'audio', texto: null, mime: 'audio/ogg' }],
    ['documento', { tipo: 'document', texto: null, mime: 'application/pdf' }],
    ['vídeo', { tipo: 'video', texto: null, mime: 'video/mp4' }],
  ])('abre: %s', (_rotulo, c) => {
    expect(abreTurno(c)).toBe(true)
  })

  it.each([
    ['figurinha (gravada como image/webp)', { tipo: 'image', texto: null, mime: MIME_DA_FIGURINHA }],
    ['figurinha com parâmetro no MIME', { tipo: 'image', texto: null, mime: 'Image/WebP; x=1' }],
    ['texto nulo (cartão de contato, enquete, botão na Evolution)', { tipo: 'text', texto: null, mime: null }],
    ['texto em branco', { tipo: 'text', texto: '  \n\t ', mime: null }],
    ['só o marcador do iOS', { tipo: 'text', texto: '\uFFFC', mime: null }],
    ['só caractere de formatação', { tipo: 'text', texto: '\u200B\u200D', mime: null }],
    ['localização', { tipo: 'location', texto: 'Rua X', mime: null }],
    ['toque em botão (Meta)', { tipo: 'interactive', texto: 'Sim', mime: null }],
    // A forma GRAVADA pelo webhook da Meta para o tipo que ele não sabe ler
    // (`contacts`, `system`, …): `text` com o rótulo. E9: não é fala do cliente.
    ['cartão de contato pela Meta (tipo não suportado)', { tipo: 'text', texto: '[Unsupported message type: contacts]', mime: null }],
    ['outro tipo não suportado pela Meta', { tipo: 'text', texto: '[Unsupported message type: system]', mime: null }],
  ])('não abre: %s', (_rotulo, c) => {
    expect(abreTurno(c)).toBe(false)
  })

  it('o prefixo recusado é o que a rota da Meta grava — o texto de sempre, sem mudar uma letra', () => {
    // A rota monta `${PREFIXO} ${tipo}]`; o inbox e a busca já leem esse texto.
    expect(`${PREFIXO_DE_TIPO_NAO_SUPORTADO} contacts]`).toBe('[Unsupported message type: contacts]')
  })

  it('só o COMEÇO do texto conta: o cliente que cita o rótulo no meio da frase abre turno', () => {
    expect(abreTurno({ tipo: 'text', texto: 'apareceu [Unsupported message type: contacts] aqui', mime: null })).toBe(true)
  })
})
