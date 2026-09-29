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

// 1067: membro SUSPENSO continua na conta, mas não recebe tarefa nova — ela
// cai na reserva, e o registro diz "suspenso", nunca "saiu da conta".
describe('escolherResponsavel — membro suspenso (1067)', () => {
  const suspensos = new Set(['cris'])
  const podeReceber = (id: string) => (membros.has(id) || suspensos.has(id)) && !suspensos.has(id)
  const ehSuspenso = (id: string) => suspensos.has(id)

  it('conversa atribuída a quem está suspenso: vai para a reserva, com o motivo próprio', () => {
    const escolha = escolherResponsavel({
      modo: 'conversa',
      dinamico: 'cris',
      fixo: 'ana',
      ehMembro: podeReceber,
      ehSuspenso,
    })
    expect(escolha).toEqual({ ok: true, userId: 'ana', porReserva: true, porque: 'suspenso' })
    expect(fraseDaEscolha('conversa', escolha)).toBe(
      'para o responsável reserva (quem está atribuído à conversa está com o acesso suspenso)'
    )
  })

  it('sem reserva, a falha diz que está suspenso', () => {
    const escolha = escolherResponsavel({
      modo: 'card',
      dinamico: 'cris',
      fixo: null,
      ehMembro: podeReceber,
      ehSuspenso,
    })
    expect(escolha).toEqual({ ok: false, motivo: 'responsavel_saiu', porque: 'suspenso' })
    expect(fraseDaEscolha('card', escolha)).toBe(
      'quem está atribuído ao card está com o acesso suspenso, e o passo não tem responsável reserva'
    )
  })

  it('responsável FIXO (ou reserva) suspenso: não recebe, e o motivo é a suspensão', () => {
    const fixo = escolherResponsavel({ modo: 'fixo', dinamico: null, fixo: 'cris', ehMembro: podeReceber, ehSuspenso })
    expect(fixo).toEqual({ ok: false, motivo: 'fixo_suspenso' })
    expect(fraseDaEscolha('fixo', fixo)).toBe('responsável está com o acesso suspenso')

    const reserva = escolherResponsavel({
      modo: 'conversa',
      dinamico: null,
      fixo: 'cris',
      ehMembro: podeReceber,
      ehSuspenso,
    })
    expect(reserva).toEqual({ ok: false, motivo: 'fixo_suspenso', porque: 'ninguem' })
    expect(fraseDaEscolha('conversa', reserva)).toBe(
      'ninguém está atribuído à conversa, e o responsável reserva está com o acesso suspenso'
    )
  })

  it('sem `ehSuspenso` (chamador antigo), tudo como antes: fora de `ehMembro` = saiu', () => {
    expect(
      escolherResponsavel({ modo: 'conversa', dinamico: 'cris', fixo: 'ana', ehMembro: podeReceber })
    ).toEqual({ ok: true, userId: 'ana', porReserva: true, porque: 'saiu' })
  })
})
