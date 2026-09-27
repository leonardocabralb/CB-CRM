import { describe, expect, it } from 'vitest'

import { lerSemRetomada, MARCADOR_SEM_RETOMADA, montarPedidoDaRetomada, montarPedidoDoAgente, secaoDaRetomada } from './pedido'
import { CANARIO_DAS_REGRAS } from './regras-do-sistema'

// ============================================================
// O pedido de uma RETOMADA (1056): o pedido do agente, sem ações, passagens
// nem horários, e a seção da retomada no FIM. Arquivo próprio: `pedido.ts`
// só ganhou funções acrescentadas no fim.
// ============================================================

const AGORA = new Date('2026-09-28T13:00:00Z')
const BASE = { instrucoes: 'Você faz a triagem.', regras: ['Nunca prometa resultado.'], agora: AGORA }

describe('montarPedidoDaRetomada', () => {
  const p = montarPedidoDaRetomada({ ...BASE, retomada: { tentativa: 2, de: 6, semResposta: '1 hour' } })

  it('é o pedido do agente, com a seção da retomada no fim', () => {
    expect(p.startsWith(montarPedidoDoAgente(BASE))).toBe(true)
    const secao = p.indexOf('Follow-up: the customer has not replied for 1 hour. This is follow-up 2 of 6.')
    expect(secao).toBeGreaterThan(p.indexOf('1. Nunca prometa resultado.'))
  })

  it('diz o que fazer: UMA pergunta, sem repetir, sem pressão, e o [[SEM_RETOMADA]] se nada estiver pendente', () => {
    expect(p).toContain('Write ONE short message')
    expect(p).toContain('one question only')
    expect(p).toContain('Never repeat a previous message word for word')
    expect(p).toContain('do not pressure the customer')
    expect(p).toContain(`reply with exactly ${MARCADOR_SEM_RETOMADA} and nothing else`)
    expect(p).toContain('Do not take any action')
  })

  it('só a ÚLTIMA tentativa diz que é a última', () => {
    expect(p).not.toContain('This IS the last follow-up.')
    expect(secaoDaRetomada({ tentativa: 6, de: 6, semResposta: '2 days' })).toContain('This IS the last follow-up.')
  })

  it('as regras do sistema valem na retomada também (vêm do pedido do agente)', () => {
    expect(p).toContain(CANARIO_DAS_REGRAS)
  })

  it('sem a seção das ações, nem a das passagens', () => {
    expect(p).not.toContain("Actions you can take in the business's CRM")
    expect(p).not.toContain('Other AI agents of the business can take this conversation over')
  })
})

describe('lerSemRetomada', () => {
  it.each(['[[SEM_RETOMADA]]', '[[sem_retomada]]', '[[ SEM RETOMADA ]]', '[SEM-RETOMADA]', 'Obrigado! [[SEM_RETOMADA]]', 'SEM_RETOMADA', ' sem retomada. '])('%s: sim', (t) => {
    expect(lerSemRetomada(t)).toBe(true)
  })

  it.each(['Sem retomada por aqui', 'Oi! Conseguiu?', '[[HANDOFF]]'])('%s: não', (t) => {
    expect(lerSemRetomada(t)).toBe(false)
  })
})
