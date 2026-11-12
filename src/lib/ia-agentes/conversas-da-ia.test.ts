import { describe, expect, it } from 'vitest'

import {
  classificarConversasDaIa,
  escolherCard,
  FOLGA_DO_CARD_MOVIDO_MS,
  pendenciaDePe,
  type CardAberto,
  type ConversaCandidata,
  type FatosDasConversas,
} from './conversas-da-ia'
import type { AgenteDaEtapa } from './quem-responde'

const LIGADO_EM = '2026-11-12T14:00:00.000Z'
const DEPOIS = '2026-11-12T15:00:00.000Z'
const ANTES = '2026-11-01T10:00:00.000Z'

const agente = (patch: Partial<AgenteDaEtapa> = {}): AgenteDaEtapa => ({
  id: 'ag1',
  ativo: true,
  arquivado: false,
  conexoes: ['canal1'],
  ativadoEm: LIGADO_EM,
  desde: LIGADO_EM,
  ...patch,
})

const card = (patch: Partial<CardAberto> = {}): CardAberto => ({
  id: 'd1',
  contactId: 'k1',
  stageId: 'etapaDaIa',
  pipelineId: 'f1',
  etapaDesde: DEPOIS,
  ...patch,
})

const conversa = (patch: Partial<ConversaCandidata> = {}): ConversaCandidata => ({
  id: 'c1',
  contactId: 'k1',
  ehGrupo: false,
  canalId: 'canal1',
  encerrada: false,
  pausada: false,
  pausadaPor: null,
  pausadaEm: null,
  ...patch,
})

const fatos = (patch: Partial<FatosDasConversas> = {}): FatosDasConversas => ({
  conversas: [conversa()],
  voltaAposMin: 15,
  canaisDoInstagram: new Set(),
  contatosQueSaoConexao: new Set(),
  cardsPorContato: new Map([['k1', [card()]]]),
  agentePorEtapa: new Map([['etapaDaIa', agente()]]),
  comTurnoVivo: new Set(),
  cardDaTransferencia: new Map(),
  ...patch,
})

const atendidas = (f: FatosDasConversas) => [...classificarConversasDaIa(f).atendimento]
const pendentes = (f: FatosDasConversas) => [...classificarConversasDaIa(f).pendencias]

describe('Atendimento da IA: a regra do motor', () => {
  it('card numa etapa com agente ligado, na conexão dele, entrou depois de ligado → atende', () => {
    expect(atendidas(fatos())).toEqual(['c1'])
  })

  it('card antigo (D27), agente desligado, fora da conexão ou etapa sem agente → não', () => {
    expect(atendidas(fatos({ cardsPorContato: new Map([['k1', [card({ etapaDesde: ANTES })]]]) }))).toEqual([])
    expect(atendidas(fatos({ agentePorEtapa: new Map([['etapaDaIa', agente({ ativo: false })]]) }))).toEqual([])
    expect(atendidas(fatos({ conversas: [conversa({ canalId: 'outro' })] }))).toEqual([])
    expect(atendidas(fatos({ agentePorEtapa: new Map() }))).toEqual([])
  })

  it('pausa TEMPORÁRIA (a equipe falou, a IA volta sozinha) continua atendimento', () => {
    const c = conversa({ pausada: true, pausadaPor: 'gente', pausadaEm: DEPOIS })
    expect(atendidas(fatos({ conversas: [c] }))).toEqual(['c1'])
  })

  it('com N = 0 na conta a pausa temporária SEGURA: sai do atendimento', () => {
    const c = conversa({ pausada: true, pausadaPor: 'botao', pausadaEm: DEPOIS })
    expect(atendidas(fatos({ conversas: [c], voltaAposMin: 0 }))).toEqual([])
  })

  it('pausa permanente (transferência, desativada, automação) nunca é atendimento, nem com turno vivo', () => {
    for (const motivo of ['transferencia', 'desativada', 'automacao']) {
      const c = conversa({ pausada: true, pausadaPor: motivo, pausadaEm: DEPOIS })
      expect(atendidas(fatos({ conversas: [c], comTurnoVivo: new Set(['c1']) }))).toEqual([])
    }
  })

  it('turno vivo (follow-up na fila) conta mesmo sem o card na etapa da IA', () => {
    expect(atendidas(fatos({ cardsPorContato: new Map(), comTurnoVivo: new Set(['c1']) }))).toEqual(['c1'])
  })

  it('encerrada, grupo, Instagram e contato que é número da conta ficam de fora', () => {
    expect(atendidas(fatos({ conversas: [conversa({ encerrada: true })] }))).toEqual([])
    expect(atendidas(fatos({ conversas: [conversa({ ehGrupo: true, contactId: null })] }))).toEqual([])
    expect(atendidas(fatos({ canaisDoInstagram: new Set(['canal1']) }))).toEqual([])
    expect(atendidas(fatos({ contatosQueSaoConexao: new Set(['k1']) }))).toEqual([])
  })
})

describe('escolherCard: a escolha de lerCardEAgente', () => {
  it('o mais recente cujo agente atende a conexão vence o mais recente de todos', () => {
    const cards = [card({ id: 'novo', stageId: 'semIa' }), card({ id: 'velho' })]
    expect(escolherCard(cards, new Map([['etapaDaIa', agente()]]), 'canal1').card?.id).toBe('velho')
  })

  it('sem nenhum que atenda, o mais recente (e quemResponde diz por quê)', () => {
    const cards = [card({ id: 'novo', stageId: 'semIa' }), card({ id: 'velho', stageId: 'outra' })]
    expect(escolherCard(cards, new Map(), 'canal1').card?.id).toBe('novo')
  })
})

describe('Pendências da IA', () => {
  const transferida = conversa({ pausada: true, pausadaPor: 'transferencia', pausadaEm: '2026-11-12T15:47:11.000Z' })

  it('transferida com o card onde a IA deixou → pendência', () => {
    const cardDaTransferencia = new Map([['c1', { status: 'open', etapaDesde: '2026-11-12T15:47:10.000Z' }]])
    expect(pendentes(fatos({ conversas: [transferida], cardDaTransferencia }))).toEqual(['c1'])
  })

  it('card mexido DEPOIS da transferência (tirado de "Pendências da IA") → sai', () => {
    const cardDaTransferencia = new Map([['c1', { status: 'open', etapaDesde: '2026-11-12T16:52:27.000Z' }]])
    expect(pendentes(fatos({ conversas: [transferida], cardDaTransferencia }))).toEqual([])
  })

  it('a folga cobre o relógio: card movido pela IA segundos "depois" da pausa continua pendência', () => {
    const quase = new Date(Date.parse('2026-11-12T15:47:11.000Z') + FOLGA_DO_CARD_MOVIDO_MS).toISOString()
    expect(pendenciaDePe('2026-11-12T15:47:11.000Z', { status: 'open', etapaDesde: quase })).toBe(true)
  })

  it('card ganho/perdido ou apagado → sai; sem turno com card → fica', () => {
    expect(pendenciaDePe(DEPOIS, { status: 'won', etapaDesde: ANTES })).toBe(false)
    expect(pendenciaDePe(DEPOIS, null)).toBe(false)
    expect(pendenciaDePe(DEPOIS, undefined)).toBe(true)
  })

  it('encerrada ou retomada (sem a pausa) não é pendência; desativada também não', () => {
    expect(pendentes(fatos({ conversas: [{ ...transferida, encerrada: true }] }))).toEqual([])
    expect(pendentes(fatos({ conversas: [conversa()] }))).toEqual([])
    expect(pendentes(fatos({ conversas: [{ ...transferida, pausadaPor: 'desativada' }] }))).toEqual([])
  })
})
