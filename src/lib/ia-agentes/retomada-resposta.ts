// ============================================================
// O que a RESPOSTA de uma retomada decide (1056). PURO, testado. UMA régua
// para o turno (`turno.ts`) e o Playground ("Simular retomada").
//
// Na retomada nada executa e nada é transferido: o `[[SEM_RETOMADA]]` ("nada
// pendente"), o `[[HANDOFF]]` em qualquer forma, o `[[TRANSFERIR]]`, a
// passagem, o pedido vazado (`vazouOPedido`, as regras do sistema), a equipe
// prometida sem marcador e o link inventado PARAM a série sem mandar nada —
// a retomada não passa a conversa para gente por conta própria. Marcador de
// ação sai do texto e não executa. A ordem é a do turno: o pedido vazado
// vem antes das outras travas do texto.
// ============================================================

import type { ChatMessage } from '@/lib/ai/types'

import { equipePrometida, lerAcoes, linksInventados } from './acoes'
import { lerPassagem, lerSemRetomada } from './pedido'
import { vazouOPedido } from './regras-do-sistema'

export type ParadaDaResposta =
  /** `[[SEM_RETOMADA]]`: nada pendente. */
  | 'nada_pendente'
  /** O modelo pediu a equipe (ou outro agente): a retomada não transfere. */
  | 'pediu_equipe'
  /** Só marcadores, nenhum texto. */
  | 'sem_texto'
  /** A resposta reproduz o pedido interno (as regras do sistema): RETIDA. */
  | 'pedido_vazado'
  /** Link que não veio do pedido nem da conversa. */
  | 'link_inventado'

export type RespostaDaRetomada =
  | { parada: null; texto: string }
  | { parada: ParadaDaResposta; detalhe?: string }

/**
 * `texto` e `handoff` como `generateReply` os devolve; `fontes` = o pedido e
 * as mensagens mandadas ao modelo (de onde um link pode ter vindo).
 */
export function lerRespostaDaRetomada(texto: string, handoff: boolean, fontes: readonly string[]): RespostaDaRetomada {
  if (lerSemRetomada(texto)) return { parada: 'nada_pendente' }
  const lidas = lerAcoes(texto)
  if (handoff || lidas.transferir || lidas.transferirDepois || lerPassagem(texto) !== null) {
    return { parada: 'pediu_equipe' }
  }
  if (!lidas.texto) return { parada: 'sem_texto' }
  if (vazouOPedido(lidas.texto)) return { parada: 'pedido_vazado', detalhe: lidas.texto }
  if (equipePrometida(lidas.texto)) return { parada: 'pediu_equipe', detalhe: lidas.texto }
  const inventados = linksInventados(lidas.texto, [...fontes])
  if (inventados.length > 0) return { parada: 'link_inventado', detalhe: inventados.join(' ') }
  return { parada: null, texto: lidas.texto }
}

/**
 * A conversa de uma retomada termina na resposta do AGENTE, e o provedor não
 * aceita isso: o Gemini recusa o pedido ("Requests ending with a model turn
 * are not supported" — MEDIDO no e2e de 27/09/2026, e o teste unitário com
 * provedor falso não pegava) e a Anthropic trata o último turno do modelo como
 * resposta a CONTINUAR. Uma nota no papel de usuário fecha a conversa, dizendo
 * por escrito que NÃO é o cliente. Vale para o turno e para o Playground.
 */
export function comNotaDaRetomada(mensagens: readonly ChatMessage[], semResposta: string): ChatMessage[] {
  return [
    ...mensagens,
    {
      role: 'user',
      content: `[System note, not a message from the customer: the customer has not replied for ${semResposta}. Write the follow-up now, following the follow-up section of your instructions.]`,
    },
  ]
}
