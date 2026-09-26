import { describe, expect, it } from 'vitest'

import { quemResponde, type FatosDaMensagem } from './quem-responde'

const CANAL = 'canal-a'
const TRIAGEM = { id: 'triagem', ativo: true, arquivado: false, conexoes: [CANAL] }
const COBRANCA = { id: 'cobranca', ativo: true, arquivado: false, conexoes: [CANAL] }

function fatos(p: Partial<FatosDaMensagem> = {}): FatosDaMensagem {
  return {
    ehGrupo: false,
    ehInstagram: false,
    canalId: CANAL,
    tipoDaMensagem: 'text',
    ehRespostaDeBotao: false,
    roboConsumiu: false,
    automacaoFalou: false,
    pausada: false,
    agenteAtivo: null,
    entrada: { agente: TRIAGEM, desde: '2026-09-25T10:00:00Z' },
    nuncaTeveGente: true,
    contatoCriadoEm: '2026-09-25T11:00:00Z',
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

  it('o agente ativo desligado, arquivado ou de OUTRA conexão não atende — e a entrada pode assumir (D16)', () => {
    for (const a of [
      { ...COBRANCA, ativo: false },
      { ...COBRANCA, arquivado: true },
      { ...COBRANCA, conexoes: ['canal-b'] },
    ]) {
      expect(quemResponde(fatos({ agenteAtivo: a }))).toEqual({ quem: 'agente', agenteId: 'triagem', via: 'entrada' })
      expect(quemResponde(fatos({ agenteAtivo: a, entrada: null }))).toEqual({ quem: 'ninguem', motivo: 'sem_agente' })
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
      { tipoDaMensagem: 'sticker' },
      { tipoDaMensagem: 'location' },
    ] as Partial<FatosDaMensagem>[]) {
      expect(quemResponde(fatos(p)), JSON.stringify(p)).toEqual({ quem: 'ninguem', motivo: 'fora_do_alcance' })
    }
  })

  it('áudio, imagem, documento e vídeo abrem turno (E9)', () => {
    for (const tipo of ['audio', 'image', 'document', 'video']) {
      expect(quemResponde(fatos({ tipoDaMensagem: tipo })).quem, tipo).toBe('agente')
    }
  })
})
