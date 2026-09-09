import { describe, it, expect } from 'vitest'
import { desfechoDoEscopo, desfechoDoRetorno } from './estado-da-execucao'

describe('desfechoDoEscopo', () => {
  it('falha vence tudo', () => {
    // Inclusive quando houve barreira e trabalho: o que o operador precisa ver
    // primeiro é que algo estourou.
    expect(
      desfechoDoEscopo({ falhou: true, barrouPorCondicao: true, fezTrabalho: true }),
    ).toBe('falhou')
  })

  it('condição que desvia para ramo vazio, sem trabalho nenhum, é barrada', () => {
    // É o caso da trava por etiqueta: a automação de contrato fechado confere
    // "já tem Cliente Fechado?" e o ramo "sim" está vazio de propósito.
    expect(
      desfechoDoEscopo({ falhou: false, barrouPorCondicao: true, fezTrabalho: false }),
    ).toBe('barrada')
  })

  it('barreira DEPOIS de trabalho feito é concluída, não barrada', () => {
    // ⚠️ A mensagem já saiu. Dizer "interrompida" faria o operador ler "não
    // rodou" sobre uma automação que falou com o cliente — mentira pior que a
    // que estamos consertando.
    expect(
      desfechoDoEscopo({ falhou: false, barrouPorCondicao: true, fezTrabalho: true }),
    ).toBe('concluida')
  })

  it('sem barreira é concluída, com ou sem trabalho', () => {
    expect(
      desfechoDoEscopo({ falhou: false, barrouPorCondicao: false, fezTrabalho: true }),
    ).toBe('concluida')
    // Automação de escopo vazio: mentira pequena, aceita de propósito —
    // "barrada" significa "uma condição desviou", e aqui não houve condição.
    expect(
      desfechoDoEscopo({ falhou: false, barrouPorCondicao: false, fezTrabalho: false }),
    ).toBe('concluida')
  })
})

describe('desfechoDoRetorno', () => {
  it('espera em curso não fecha o log', () => {
    // Fechar aqui afirmaria "concluída" sobre execução que ainda vai mandar
    // mensagem — o follow-up de 30 dias tem 9 esperas pela frente.
    expect(desfechoDoRetorno('partial')).toBeNull()
  })

  it('falha e sucesso viram desfecho; ramo vazio no resume conta como concluída', () => {
    expect(desfechoDoRetorno('failed')).toBe('falhou')
    expect(desfechoDoRetorno('success')).toBe('concluida')
    // `null` do motor = "ramo sem passo nenhum". No resume não há como saber se
    // houve barreira (a condição foi avaliada dias antes, noutra execução do
    // escopo), então nunca se inventa `barrada` por este caminho.
    expect(desfechoDoRetorno(null)).toBe('concluida')
  })
})
