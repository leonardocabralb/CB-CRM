import { describe, expect, it } from 'vitest'

import { abreTurno, MIME_DA_FIGURINHA, quemResponde, TIPOS_QUE_ABREM_TURNO, type FatosDaMensagem } from './quem-responde'

const CANAL = 'canal-a'
const TRIAGEM = { id: 'triagem', ativo: true, arquivado: false, conexoes: [CANAL] }
const COBRANCA = { id: 'cobranca', ativo: true, arquivado: false, conexoes: [CANAL] }

function fatos(p: Partial<FatosDaMensagem> = {}): FatosDaMensagem {
  return {
    ehGrupo: false,
    ehInstagram: false,
    canalId: CANAL,
    conteudo: { tipo: 'text', texto: 'Oi', mime: null },
    ehRespostaDeBotao: false,
    roboConsumiu: false,
    automacaoFalou: false,
    pausada: false,
    agenteAtivo: null,
    entrada: { agente: TRIAGEM, desde: '2026-09-25T10:00:00Z' },
    nuncaTeveGente: true,
    contatoCriadoEm: '2026-09-25T11:00:00Z',
    conversaCriadaEm: '2026-09-25T11:00:00.300Z',
    ...p,
  }
}

describe('quemResponde — a ordem das regras (5.3)', () => {
  it('contato novo, nunca atendido, na conexão com entrada: a entrada atende', () => {
    expect(quemResponde(fatos())).toEqual({ quem: 'agente', agenteId: 'triagem', via: 'entrada' })
  })

  it('o agente ATIVO vence a entrada, e o responsável humano não entra na conta', () => {
    expect(quemResponde(fatos({ agenteAtivo: COBRANCA, nuncaTeveGente: false }))).toEqual({
      quem: 'agente',
      agenteId: 'cobranca',
      via: 'ativo',
    })
  })

  it('robô, automação que falou e pausa calam — nesta ordem, antes de qualquer agente', () => {
    expect(quemResponde(fatos({ roboConsumiu: true, automacaoFalou: true }))).toEqual({ quem: 'ninguem', motivo: 'robo' })
    expect(quemResponde(fatos({ automacaoFalou: true, pausada: true }))).toEqual({ quem: 'ninguem', motivo: 'automacao' })
    expect(quemResponde(fatos({ pausada: true, agenteAtivo: COBRANCA }))).toEqual({ quem: 'ninguem', motivo: 'pausada' })
  })

  it('D16: conversa que JÁ teve resposta de gente não recebe a entrada', () => {
    expect(quemResponde(fatos({ nuncaTeveGente: false }))).toEqual({ quem: 'ninguem', motivo: 'sem_agente' })
  })

  it('P8 (E3): contato criado ANTES de a entrada ser ligada (Kommo, Asaas, CSV) não recebe a entrada', () => {
    expect(quemResponde(fatos({ contatoCriadoEm: '2026-09-01T00:00:00Z' }))).toEqual({
      quem: 'ninguem',
      motivo: 'sem_agente',
    })
    // Sem as datas, não atende (o lado que atende menos gente).
    expect(quemResponde(fatos({ contatoCriadoEm: null })).quem).toBe('ninguem')
    expect(quemResponde(fatos({ entrada: { agente: TRIAGEM, desde: null } })).quem).toBe('ninguem')
  })

  it('P8: contato IMPORTADO depois da entrada (CSV, Asaas) — nasceu sem a conversa — não recebe a entrada (Codex, #292)', () => {
    // A conversa só apareceu quando ele escreveu, dias depois da importação.
    expect(quemResponde(fatos({ conversaCriadaEm: '2026-09-28T09:00:00Z' }))).toEqual({
      quem: 'ninguem',
      motivo: 'sem_agente',
    })
    expect(quemResponde(fatos({ conversaCriadaEm: null })).quem).toBe('ninguem')
    // Nascido junto (a ingestão cria os dois na mesma requisição): atende.
    expect(quemResponde(fatos({ conversaCriadaEm: '2026-09-25T11:01:30Z' })).quem).toBe('agente')
  })

  it('o agente ativo desligado, arquivado ou de OUTRA conexão não atende — e a entrada NÃO o substitui (Codex, #292)', () => {
    for (const a of [
      { ...COBRANCA, ativo: false },
      { ...COBRANCA, arquivado: true },
      { ...COBRANCA, conexoes: ['canal-b'] },
    ]) {
      expect(quemResponde(fatos({ agenteAtivo: a }))).toEqual({ quem: 'ninguem', motivo: 'agente_ativo_indisponivel' })
      expect(quemResponde(fatos({ agenteAtivo: a, entrada: null }))).toEqual({
        quem: 'ninguem',
        motivo: 'agente_ativo_indisponivel',
      })
    }
  })

  it('a entrada desligada ou sem a conexão nas dela não atende', () => {
    expect(quemResponde(fatos({ entrada: { agente: { ...TRIAGEM, ativo: false }, desde: '2026-09-25T10:00:00Z' } })).quem).toBe('ninguem')
    expect(quemResponde(fatos({ entrada: { agente: { ...TRIAGEM, conexoes: [] }, desde: '2026-09-25T10:00:00Z' } })).quem).toBe('ninguem')
  })

  it('fora do alcance: grupo, Instagram, sem conexão, toque em botão, figurinha e localização', () => {
    for (const p of [
      { ehGrupo: true },
      { ehInstagram: true },
      { canalId: null },
      { ehRespostaDeBotao: true },
      { conteudo: { tipo: 'image', texto: null, mime: 'image/webp' } },
      { conteudo: { tipo: 'location', texto: 'Rua X', mime: null } },
      { conteudo: { tipo: 'text', texto: null, mime: null } },
    ] as Partial<FatosDaMensagem>[]) {
      expect(quemResponde(fatos(p)), JSON.stringify(p)).toEqual({ quem: 'ninguem', motivo: 'fora_do_alcance' })
    }
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
  ])('não abre: %s', (_rotulo, c) => {
    expect(abreTurno(c)).toBe(false)
  })
})
