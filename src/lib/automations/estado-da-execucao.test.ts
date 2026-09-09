import { describe, it, expect } from 'vitest'
import { desfechoDoEscopo, desfechoDoRetorno, sinaisDoHistorico } from './estado-da-execucao'

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

describe('sinaisDoHistorico', () => {
  it('passo comum bem-sucedido é TRABALHO', () => {
    expect(
      sinaisDoHistorico([{ step_id: 's1', step_type: 'send_message', status: 'success' }]),
    ).toEqual({ fezTrabalho: true, barrouPorCondicao: false })
  })

  it('esperar e avaliar condição NÃO são trabalho', () => {
    // É a distinção que faz `barrada` existir: a execução que só esperou e
    // morreu numa trava não fez nada no mundo.
    expect(
      sinaisDoHistorico([
        { step_id: 's1', step_type: 'wait', status: 'success' },
        { step_id: 's2', step_type: 'condition', status: 'success' },
      ]),
    ).toEqual({ fezTrabalho: false, barrouPorCondicao: false })
  })

  it('condição marcada `skipped` é a assinatura da BARREIRA', () => {
    expect(sinaisDoHistorico([{ step_id: 's1', step_type: 'condition', status: 'skipped' }])).toEqual(
      { fezTrabalho: false, barrouPorCondicao: true },
    )
  })

  it('passo que FALHOU não conta como trabalho', () => {
    // Quem responde por falha é o `status` do escopo; contar aqui faria
    // `[condição vazia][passo que estourou]` parecer trabalho feito.
    expect(
      sinaisDoHistorico([{ step_id: 's1', step_type: 'send_message', status: 'failed' }]),
    ).toEqual({ fezTrabalho: false, barrouPorCondicao: false })
  })

  it('o caso que motivou a função: enviar, esperar, e barrar depois', () => {
    // `[enviar][aguardar][condição de ramo vazio]` — o follow-up de no-show.
    // Houve trabalho E houve barreira; `desfechoDoEscopo` decide por
    // 'concluida', porque a mensagem SAIU.
    const sinais = sinaisDoHistorico([
      { step_id: 's1', step_type: 'send_message', status: 'success' },
      { step_id: 's2', step_type: 'wait', status: 'success' },
      { step_id: 's3', step_type: 'condition', status: 'skipped' },
    ])
    expect(sinais).toEqual({ fezTrabalho: true, barrouPorCondicao: true })
    expect(desfechoDoEscopo({ falhou: false, ...sinais })).toBe('concluida')
  })

  it('JSONB torto não derruba a régua', () => {
    // A coluna é nula em log que ainda não rodou passo, e pode ter sido
    // gravada por uma versão que não conhecia um campo de hoje.
    const vazio = { fezTrabalho: false, barrouPorCondicao: false }
    expect(sinaisDoHistorico(null)).toEqual(vazio)
    expect(sinaisDoHistorico(undefined)).toEqual(vazio)
    expect(sinaisDoHistorico('não é lista')).toEqual(vazio)
    expect(sinaisDoHistorico([null, 42, {}, { step_type: 7, status: true }])).toEqual(vazio)
  })
})
