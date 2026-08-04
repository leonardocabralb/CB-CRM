import { describe, expect, it } from 'vitest'
import type { Automation } from '@/types'

import { montarGrade, trechosContinuos } from './grade-do-funil'

// ------------------------------------------------------------
// A posição do cartão na grade é uma AFIRMAÇÃO sobre onde a regra roda.
// Cartão largo demais diz que a automação vale numa etapa em que ela não
// vale — e o operador não tem como desconfiar, porque a tela desenhou.
// ------------------------------------------------------------

const ETAPAS = ['e0', 'e1', 'e2', 'e3', 'e4']

const auto = (id: string, stage_ids?: string[] | null): Automation =>
  ({
    id,
    name: id,
    trigger_type: 'deal_stage_changed',
    trigger_config: stage_ids === null ? {} : { stage_ids },
    is_active: true,
  }) as unknown as Automation

describe('trechosContinuos', () => {
  it('colunas vizinhas viram um trecho só', () => {
    expect(trechosContinuos([1, 2, 3])).toEqual([{ inicio: 1, tamanho: 3 }])
  })

  it('CRÍTICO: coluna 1 e 3 NÃO viram um retângulo de 1 a 3', () => {
    // Um retângulo daqui até ali afirmaria que a regra vale na 2. Ela não
    // vale. Dois trechos, cada um verdadeiro.
    expect(trechosContinuos([1, 3])).toEqual([
      { inicio: 1, tamanho: 1 },
      { inicio: 3, tamanho: 1 },
    ])
  })

  it('ordena e remove repetido antes de agrupar', () => {
    expect(trechosContinuos([3, 1, 2, 1])).toEqual([{ inicio: 1, tamanho: 3 }])
  })

  it('lista vazia devolve nada', () => {
    expect(trechosContinuos([])).toEqual([])
  })
})

describe('montarGrade — largura do cartão', () => {
  it('uma etapa ocupa uma coluna', () => {
    const g = montarGrade([auto('a', ['e2'])], ETAPAS)
    expect(g).toHaveLength(1)
    expect(g[0][0]).toMatchObject({ colunaInicial: 2, colunas: 1, todasAsEtapas: false })
  })

  it('três etapas vizinhas atravessam três colunas', () => {
    const g = montarGrade([auto('a', ['e1', 'e2', 'e3'])], ETAPAS)
    expect(g[0][0]).toMatchObject({ colunaInicial: 1, colunas: 3 })
  })

  it('CRÍTICO: sem etapa escolhida ocupa o quadro INTEIRO', () => {
    // É o "Webhook" que atravessa a tela no Kommo, e o grupo "De todas as
    // etapas" do painel. Desenhar isso como um cartão de uma coluna só
    // esconderia que a regra dispara em todas.
    const g = montarGrade([auto('a', null)], ETAPAS)
    expect(g[0][0]).toMatchObject({
      colunaInicial: 0,
      colunas: 5,
      todasAsEtapas: true,
    })
  })

  it('lista vazia de etapas conta como sem escolha', () => {
    const g = montarGrade([auto('a', [])], ETAPAS)
    expect(g[0][0]).toMatchObject({ colunas: 5, todasAsEtapas: true })
  })

  it('etapas não vizinhas viram DOIS cartões da mesma automação', () => {
    const g = montarGrade([auto('a', ['e0', 'e3'])], ETAPAS)
    const cartoes = g.flat()
    expect(cartoes).toHaveLength(2)
    expect(cartoes.map((c) => c.colunaInicial).sort()).toEqual([0, 3])
    // Os dois precisam avisar que há mais da mesma regra em outro lugar.
    expect(cartoes.every((c) => c.temOutrosTrechos)).toBe(true)
  })
})

describe('montarGrade — o que NÃO entra', () => {
  it('outro tipo de gatilho fica fora', () => {
    const a = auto('a', ['e1'])
    ;(a as { trigger_type: string }).trigger_type = 'keyword_match'
    expect(montarGrade([a], ETAPAS)).toEqual([])
  })

  it('automação de OUTRO funil some deste quadro', () => {
    expect(montarGrade([auto('a', ['zzz'])], ETAPAS)).toEqual([])
  })

  it('CRÍTICO: cobre este funil E outro → aparece, marcada', () => {
    // Some daqui seria pior: a regra dispara nesta etapa e o quadro diria
    // que não há nada. Aparece, e o cartão avisa que há mais fora.
    const g = montarGrade([auto('a', ['e1', 'de-outro-funil'])], ETAPAS)
    expect(g.flat()).toHaveLength(1)
    expect(g.flat()[0]).toMatchObject({ colunaInicial: 1, colunas: 1, temOutrosTrechos: true })
  })

  it('quadro sem etapa nenhuma não inventa cartão de largura zero', () => {
    expect(montarGrade([auto('a', null)], [])).toEqual([])
  })
})

describe('montarGrade — empilhamento em linhas', () => {
  it('cartões que não se tocam dividem a mesma linha', () => {
    const g = montarGrade([auto('a', ['e0']), auto('b', ['e3'])], ETAPAS)
    expect(g).toHaveLength(1)
    expect(g[0]).toHaveLength(2)
  })

  it('CRÍTICO: cartões que disputam a mesma coluna vão para linhas diferentes', () => {
    const g = montarGrade([auto('a', ['e1']), auto('b', ['e1'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0][0].automation.id).toBe('a')
    expect(g[1][0].automation.id).toBe('b')
  })

  it('sobreposição PARCIAL também separa', () => {
    // e1-e2 e e2-e3 dividem a e2. Na mesma linha, um cobriria o outro.
    const g = montarGrade([auto('a', ['e1', 'e2']), auto('b', ['e2', 'e3'])], ETAPAS)
    expect(g).toHaveLength(2)
  })

  it('a de largura total empurra a seguinte para baixo', () => {
    const g = montarGrade([auto('todas', null), auto('b', ['e0'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0][0].todasAsEtapas).toBe(true)
  })

  it('a terceira reaproveita a primeira linha se couber', () => {
    // a=[e0], b=[e0] (vai para a linha 2), c=[e4] cabe de volta na linha 1.
    const g = montarGrade([auto('a', ['e0']), auto('b', ['e0']), auto('c', ['e4'])], ETAPAS)
    expect(g).toHaveLength(2)
    expect(g[0].map((x) => x.automation.id)).toEqual(['a', 'c'])
  })

  it('preserva a ordem em que as automações chegaram', () => {
    // A ordem da lista é a que o operador já viu na tela de automações;
    // reordenar por "esperteza" faria o mesmo funil parecer outro.
    const g = montarGrade([auto('z', ['e0']), auto('y', ['e1'])], ETAPAS)
    expect(g[0].map((c) => c.automation.id)).toEqual(['z', 'y'])
  })
})
