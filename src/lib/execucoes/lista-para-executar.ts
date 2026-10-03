// ============================================================
// A lista da janela "Executar automação" do inbox — pura, testável.
//
// Duas metades: o que dá para executar AGORA (automação ligada, robô ativo)
// e, no fim, o que está DESLIGADO. As desligadas aparecem por decisão do
// operador (29/09/2026): ele procurou "(PENDENTE) Contrato fechado" na
// janela e não achou — ela estava desligada, a consulta só trazia
// `is_active = true`, e a leitura foi "a automação sumiu". É a mesma razão
// de o item fora do canal ficar visível: esconder faz a pessoa procurar o
// defeito no lugar errado. Na tela elas vêm apagadas, SEM clique e com o
// motivo; quem recusa de verdade continua sendo a rota
// (`/api/cb/execucoes/executar` devolve `inactive`).
//
// ⚠️ Só o booleano `true` liga (a regra da casa para flag vinda do banco):
// qualquer outro valor cai em "desligada". É o lado seguro — um botão a
// menos se desfaz ligando a automação; a rota recusaria de todo jeito.
// ⚠️ A régua do Asaas (998) fica FORA dos dois grupos, ligada ou não: ela só
// roda pela varredura, e mostrá-la entre as desligadas convidaria a ligá-la
// para executar à mão — o que a rota também recusa (`runAutomationById`).
// NOSSO (1073): a "Situação mudou no Atlas" também (`soRodaPeloDisparador`):
// só roda pela leitura do Atlas, que escolhe o card do evento.
// ============================================================

import { soRodaPeloDisparador } from '@/lib/automations/so-pelo-disparador'
import { semAcento } from '@/lib/inbox/busca-em-mensagens'

export interface AutomacaoParaExecutar {
  id: string
  name: string
  description: string | null
  /** Escopo de canal (903): vazio/nulo = todos os números. */
  channel_ids: string[] | null
  /** a régua do Asaas (998) não é oferecida aqui */
  trigger_type: string
  is_active: boolean | null
}

export interface RoboParaExecutar {
  id: string
  name: string
  /** Escopo SINGULAR (903): nulo = todos os números. */
  channel_id: string | null
  /** O CHECK da 0010: só `active` roda; `draft` e `archived` não. */
  status: 'draft' | 'active' | 'archived'
}

/** Item da seção "Desligadas" — as duas formas, na mesma lista. */
export type ItemDesligado =
  | { tipo: 'automacao'; automacao: AutomacaoParaExecutar }
  | { tipo: 'robo'; robo: RoboParaExecutar }

export interface ListaParaExecutar {
  /** Automações ligadas, na ordem recebida (a consulta ordena por nome). */
  automacoes: AutomacaoParaExecutar[]
  /** Robôs ativos, na ordem recebida. */
  robos: RoboParaExecutar[]
  /** Automações desligadas primeiro, depois os robôs não ativos. */
  desligadas: ItemDesligado[]
}

/**
 * Separa o que a janela oferece do que ela só MOSTRA, já recortado pela
 * busca. A busca vale para os dois grupos — senão digitar o nome de uma
 * desligada responderia "nada casa com a busca", que é o mesmo engano de
 * antes com outra frase.
 *
 * `busca` é o texto cru da caixa: aparado e sem acento aqui, como o resto do
 * inbox (com `.toLowerCase()` cru, "cobranca" não achava "Cobrança").
 */
export function separarParaExecutar(
  automacoes: readonly AutomacaoParaExecutar[],
  robos: readonly RoboParaExecutar[],
  busca: string,
): ListaParaExecutar {
  const termo = semAcento(busca.trim())
  const casa = (nome: string) => !termo || semAcento(nome).includes(termo)

  const lista: ListaParaExecutar = { automacoes: [], robos: [], desligadas: [] }
  const robosDesligados: ItemDesligado[] = []

  for (const a of automacoes) {
    if (soRodaPeloDisparador(a.trigger_type) || !casa(a.name)) continue
    if (a.is_active === true) lista.automacoes.push(a)
    else lista.desligadas.push({ tipo: 'automacao', automacao: a })
  }
  for (const r of robos) {
    if (!casa(r.name)) continue
    if (r.status === 'active') lista.robos.push(r)
    else robosDesligados.push({ tipo: 'robo', robo: r })
  }
  lista.desligadas.push(...robosDesligados)
  return lista
}

/** Nada a mostrar em nenhum dos grupos — o único caso do estado vazio. */
export function listaVazia(lista: ListaParaExecutar): boolean {
  return (
    lista.automacoes.length === 0 &&
    lista.robos.length === 0 &&
    lista.desligadas.length === 0
  )
}
