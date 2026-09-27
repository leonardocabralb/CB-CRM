// ============================================================
// O que a RESPOSTA de uma retomada decide (1056). PURO, testado. UMA régua
// para o turno (`turno.ts`) e o Playground ("Simular retomada").
//
// Na retomada nada executa e nada é transferido: o `[[SEM_RETOMADA]]` ("nada
// pendente"), o `[[HANDOFF]]` em qualquer forma, o `[[TRANSFERIR]]`, a
// passagem, a equipe prometida sem marcador e o link inventado PARAM a série
// sem mandar nada — a retomada não passa a conversa para gente por conta
// própria. Marcador de ação sai do texto e não executa.
// ============================================================

import { equipePrometida, lerAcoes, linksInventados } from './acoes'
import { lerPassagem, lerSemRetomada } from './pedido'

export type ParadaDaResposta =
  /** `[[SEM_RETOMADA]]`: nada pendente. */
  | 'nada_pendente'
  /** O modelo pediu a equipe (ou outro agente): a retomada não transfere. */
  | 'pediu_equipe'
  /** Só marcadores, nenhum texto. */
  | 'sem_texto'
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
  if (equipePrometida(lidas.texto)) return { parada: 'pediu_equipe', detalhe: lidas.texto }
  const inventados = linksInventados(lidas.texto, [...fontes])
  if (inventados.length > 0) return { parada: 'link_inventado', detalhe: inventados.join(' ') }
  return { parada: null, texto: lidas.texto }
}
