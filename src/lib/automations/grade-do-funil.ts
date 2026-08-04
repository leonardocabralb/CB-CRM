import type { Automation, DealStageTriggerConfig } from '@/types'

/**
 * A GRADE de automações do funil — colunas são etapas, cartões ocupam as
 * colunas em que a automação dispara (estilo Kommo).
 *
 * Puro e fora da tela pelo mesmo motivo de `por-etapa.ts`: a posição do cartão
 * é uma AFIRMAÇÃO sobre onde a regra roda, e afirmação errada aqui é a tela
 * mentindo com cara de certa.
 *
 * ⚠️ "Expandir" o cartão para mais colunas é gravar mais etapas em
 * `trigger_config.stage_ids`. Não há coluna nova, nem migration: a largura do
 * cartão É o conteúdo daquele campo. Vazio = ocupa o funil inteiro.
 */

/** Um cartão já posicionado: onde começa, quantas colunas ocupa. */
export interface CartaoDaGrade {
  automation: Automation
  /** Índice da primeira coluna (0-based), na ordem das etapas do quadro. */
  colunaInicial: number
  /** Quantas colunas ele atravessa. Sempre ≥ 1. */
  colunas: number
  /**
   * A automação não escolheu etapa: vale para TODAS, inclusive as de outros
   * funis. Ocupa a largura toda deste quadro, mas o cartão precisa dizer isso
   * — senão o operador lê "vale destas 9 etapas" e edita achando que recorta
   * só o que está vendo.
   */
  todasAsEtapas: boolean
  /**
   * A automação cobre etapas fora deste trecho contínuo (ou fora deste funil).
   * Existe porque um cartão só desenha um retângulo, e etapas não vizinhas
   * viram vários cartões.
   */
  temOutrosTrechos: boolean
}

/** Uma faixa horizontal da grade. Cartões da mesma linha nunca se sobrepõem. */
export type LinhaDaGrade = CartaoDaGrade[]

/**
 * Trechos CONTÍNUOS de colunas que a automação cobre.
 *
 * ⚠️ Etapa 1 e 3, pulando a 2, NÃO pode virar um retângulo de 1 a 3 — isso
 * seria a tela afirmando que a regra vale na 2. Viram dois cartões, cada um
 * verdadeiro. É por isso que esta função devolve uma lista.
 */
export function trechosContinuos(indices: number[]): Array<{ inicio: number; tamanho: number }> {
  const ordenados = [...new Set(indices)].sort((a, b) => a - b)
  const trechos: Array<{ inicio: number; tamanho: number }> = []
  for (const i of ordenados) {
    const ultimo = trechos[trechos.length - 1]
    if (ultimo && i === ultimo.inicio + ultimo.tamanho) ultimo.tamanho += 1
    else trechos.push({ inicio: i, tamanho: 1 })
  }
  return trechos
}

/**
 * Monta a grade. `stageIds` vem na ORDEM das colunas do quadro — a ordem é
 * dado de entrada, não detalhe: é ela que decide o que é vizinho.
 *
 * Empilha em linhas de modo que dois cartões nunca disputem a mesma célula.
 * Primeiro-que-cabe, na ordem recebida: sem ordenação esperta, porque a ordem
 * das automações na tela é a que o operador já viu na lista.
 */
export function montarGrade(
  automations: Automation[],
  stageIds: string[],
): LinhaDaGrade[] {
  const posicao = new Map(stageIds.map((id, i) => [id, i]))
  const linhas: LinhaDaGrade[] = []

  for (const a of automations) {
    if (a.trigger_type !== 'deal_stage_changed') continue

    const alvo = (a.trigger_config as DealStageTriggerConfig | undefined)?.stage_ids
    const semEscolha = !Array.isArray(alvo) || alvo.length === 0

    let cartoes: Array<Omit<CartaoDaGrade, 'automation'>>
    if (semEscolha) {
      // Sem etapa escolhida = todas. Ocupa a largura do quadro.
      if (stageIds.length === 0) continue
      cartoes = [
        {
          colunaInicial: 0,
          colunas: stageIds.length,
          todasAsEtapas: true,
          temOutrosTrechos: false,
        },
      ]
    } else {
      const daqui = alvo.map((id) => posicao.get(id)).filter((i): i is number => i !== undefined)
      // Etapa de OUTRO funil (ou apagada) não aparece neste quadro. Se sobrou
      // nada, a automação não pertence a este funil — some da grade.
      if (daqui.length === 0) continue
      const trechos = trechosContinuos(daqui)
      // "Tem outros trechos" cobre os dois casos: etapa em outro funil
      // (`alvo` maior que `daqui`) e etapa não vizinha aqui mesmo.
      const foraDaqui = alvo.length > daqui.length
      cartoes = trechos.map((t) => ({
        colunaInicial: t.inicio,
        colunas: t.tamanho,
        todasAsEtapas: false,
        temOutrosTrechos: foraDaqui || trechos.length > 1,
      }))
    }

    for (const c of cartoes) {
      const cartao: CartaoDaGrade = { automation: a, ...c }
      const linha = linhas.find((l) => cabeNaLinha(l, cartao))
      if (linha) linha.push(cartao)
      else linhas.push([cartao])
    }
  }

  return linhas
}

function cabeNaLinha(linha: LinhaDaGrade, novo: CartaoDaGrade): boolean {
  return !linha.some(
    (c) =>
      novo.colunaInicial < c.colunaInicial + c.colunas &&
      c.colunaInicial < novo.colunaInicial + novo.colunas,
  )
}
