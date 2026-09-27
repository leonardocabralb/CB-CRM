import { describe, expect, it } from 'vitest'

import { escolherResponsavel, fraseDaEscolha, lerModoDoResponsavel } from './responsavel-da-tarefa'

const membros = new Set(['ana', 'bia'])
const ehMembro = (id: string) => membros.has(id)

describe('lerModoDoResponsavel', () => {
  it('ausente é FIXO — toda tarefa gravada antes da Fase 2.4', () => {
    expect(lerModoDoResponsavel(undefined)).toBe('fixo')
    expect(lerModoDoResponsavel(null)).toBe('fixo')
    expect(lerModoDoResponsavel('')).toBe('fixo')
  })
  it('os três modos, e lixo vira null', () => {
    expect(lerModoDoResponsavel('conversa')).toBe('conversa')
    expect(lerModoDoResponsavel('card')).toBe('card')
    expect(lerModoDoResponsavel('fixo')).toBe('fixo')
    expect(lerModoDoResponsavel('Conversa')).toBeNull()
    expect(lerModoDoResponsavel(1)).toBeNull()
  })
})

describe('escolherResponsavel', () => {
  it('fixo: a pessoa do passo, e só ela', () => {
    expect(escolherResponsavel({ modo: 'fixo', dinamico: 'bia', fixo: 'ana', ehMembro })).toEqual({
      ok: true,
      userId: 'ana',
      porReserva: false,
    })
    expect(escolherResponsavel({ modo: 'fixo', dinamico: null, fixo: 'zé', ehMembro })).toEqual({
      ok: false,
      motivo: 'fixo_fora_da_conta',
    })
    expect(escolherResponsavel({ modo: 'fixo', dinamico: null, fixo: '', ehMembro })).toEqual({
      ok: false,
      motivo: 'sem_responsavel',
    })
  })

  it('conversa/card: quem está atribuído vence a reserva', () => {
    expect(escolherResponsavel({ modo: 'conversa', dinamico: 'bia', fixo: 'ana', ehMembro })).toEqual({
      ok: true,
      userId: 'bia',
      porReserva: false,
    })
  })

  it('ninguém atribuído: a reserva, dito como reserva', () => {
    expect(escolherResponsavel({ modo: 'card', dinamico: null, fixo: 'ana', ehMembro })).toEqual({
      ok: true,
      userId: 'ana',
      porReserva: true,
      porque: 'ninguem',
    })
  })

  it('atribuído que SAIU da conta também cai na reserva', () => {
    expect(escolherResponsavel({ modo: 'conversa', dinamico: 'ex-membro', fixo: 'ana', ehMembro })).toEqual({
      ok: true,
      userId: 'ana',
      porReserva: true,
      porque: 'saiu',
    })
  })

  it('sem ninguém e sem reserva: falha com o motivo certo, nunca "o autor da regra"', () => {
    expect(escolherResponsavel({ modo: 'conversa', dinamico: null, fixo: null, ehMembro })).toEqual({
      ok: false,
      motivo: 'sem_responsavel',
      porque: 'ninguem',
    })
    expect(escolherResponsavel({ modo: 'card', dinamico: 'ex-membro', fixo: '  ', ehMembro })).toEqual({
      ok: false,
      motivo: 'responsavel_saiu',
      porque: 'saiu',
    })
    expect(escolherResponsavel({ modo: 'card', dinamico: null, fixo: 'zé', ehMembro })).toEqual({
      ok: false,
      motivo: 'fixo_fora_da_conta',
      porque: 'ninguem',
    })
  })

  it('contato SEM conversa/card: o porquê diz isso, não "ninguém atribuído"', () => {
    expect(
      escolherResponsavel({ modo: 'conversa', dinamico: null, alvoExiste: false, fixo: 'ana', ehMembro })
    ).toEqual({ ok: true, userId: 'ana', porReserva: true, porque: 'sem_alvo' })
  })
})

describe('fraseDaEscolha — o que o histórico da automação diz', () => {
  it('foi para quem o passo pedia: nada a explicar', () => {
    expect(fraseDaEscolha('conversa', { ok: true, userId: 'bia', porReserva: false })).toBeNull()
    expect(fraseDaEscolha('fixo', { ok: true, userId: 'ana', porReserva: false })).toBeNull()
  })

  it('pela reserva: diz POR QUÊ — ninguém, saiu ou sem conversa/card', () => {
    expect(
      fraseDaEscolha('conversa', { ok: true, userId: 'ana', porReserva: true, porque: 'ninguem' })
    ).toBe('para o responsável reserva (ninguém está atribuído à conversa)')
    expect(
      fraseDaEscolha('card', { ok: true, userId: 'ana', porReserva: true, porque: 'saiu' })
    ).toBe('para o responsável reserva (quem estava atribuído ao card não é mais membro desta conta)')
    expect(
      fraseDaEscolha('card', { ok: true, userId: 'ana', porReserva: true, porque: 'sem_alvo' })
    ).toBe('para o responsável reserva (o contato não tem card)')
  })

  it('falha: quem saiu não é dito "sem responsável"; reserva fora da conta é nomeada', () => {
    expect(
      fraseDaEscolha('conversa', { ok: false, motivo: 'responsavel_saiu', porque: 'saiu' })
    ).toBe('quem estava atribuído à conversa não é mais membro desta conta, e o passo não tem responsável reserva')
    expect(
      fraseDaEscolha('card', { ok: false, motivo: 'fixo_fora_da_conta', porque: 'saiu' })
    ).toBe('quem estava atribuído ao card não é mais membro desta conta, e o responsável reserva não é membro desta conta')
    expect(fraseDaEscolha('fixo', { ok: false, motivo: 'fixo_fora_da_conta' })).toBe(
      'responsável não é membro desta conta'
    )
  })
})
