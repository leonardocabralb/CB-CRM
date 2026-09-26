// ============================================================
// Condição "Janela de 24h da Meta aberta?" das automações (Fase 2.8 do
// `docs/PLANO-previdenciario.md`).
//
// Para que serve: o pós-assinatura e os lembretes do link precisam decidir
// "texto livre ou modelo aprovado?". Fora da janela a Meta ACEITA o pedido e
// recusa depois (131047, recibo "falhou") — o passo aparece como concluído e
// o cliente não recebe nada. A condição deixa a automação escolher antes:
// sim → texto; não → modelo.
//
// ⚠️ A régua é a da ampulheta da lista e do fio — o mapa
// `conversations.janela_meta` (993), lido por `minutosRestantesNoMapa` com o
// canal de SAÍDA. NÃO o `seloDaJanela` inteiro: ele cala para conversa
// ENCERRADA (decisão de TELA), e o lembrete do link sai justamente para quem
// ainda não voltou a falar.
//
// ⚠️ Duas respostas diferentes do fio, de propósito:
//  - Fio vazio / cliente que nunca escreveu pelo número oficial = FECHADA.
//    No fio isso fica "aberta" para não travar o compositor da conversa que o
//    CRM acabou de abrir (o operador vê o erro e escolhe um modelo); aqui não
//    há ninguém olhando, e texto livre nesse caso é recusado pela Meta.
//  - Conversa encerrada conta como qualquer outra (o selo esconde; a janela
//    continua existindo do lado da Meta).
// ============================================================

import { ehEvolution, ehMeta } from '@/lib/cb-channels/transporte'
import { minutosRestantesNoMapa } from '@/lib/inbox/selo-da-janela'

/** O mínimo da conversa que a regra lê. */
export interface ConversaDaJanela {
  group_id?: string | null
  janela_meta?: Record<string, string> | null
}

/**
 * O número por onde a próxima mensagem sairia (o `ResolvedChannel` do motor):
 * o transporte e o id da conexão. `channelId` nulo = o espelho legado
 * `whatsapp_config` (conta sem conexão nenhuma).
 */
export interface SaidaDaJanela {
  provider: string | null | undefined
  channelId: string | null
}

/**
 * A Meta aceitaria TEXTO LIVRE agora, nesta conversa, por este número?
 *
 * - Grupo → sim: grupo é só Evolution e não tem janela (automação nem roda em
 *   grupo, 906; a resposta existe para não depender disso).
 * - Sem número de saída → não: nada sai por lugar nenhum, e "não" leva ao
 *   modelo, que também falha — mas com o motivo certo no registro.
 * - Evolution (QR Code) → SEMPRE sim: não há janela nesse transporte.
 * - Instagram → não: a janela do Direct é outra regra, fora do mapa, e
 *   automação não envia no Instagram (D1 do plano do Instagram).
 * - Meta → sim só com minutos restantes no número de saída.
 */
export function janelaDaMetaAberta(
  conversa: ConversaDaJanela,
  saida: SaidaDaJanela | null,
  agoraMs: number,
): boolean {
  if (conversa.group_id) return true
  if (!saida) return false
  if (ehEvolution(saida)) return true
  if (!ehMeta(saida)) return false
  return minutosRestantesNoMapa(conversa.janela_meta ?? null, saida.channelId, agoraMs) > 0
}
