import type { ChatMessage } from '../types'
import { mergeConsecutive } from './shared'

// ============================================================
// A conversa que o ESCRITÓRIO abriu chega inteira ao modelo (09/11/2026).
//
// Anthropic e Gemini exigem a conversa começando no cliente (`user`) e com
// papéis alternados. O adaptador DESCARTAVA as mensagens nossas do começo — e
// a conversa aberta pelo escritório (o formulário do anúncio, a mensagem do
// CRM, o disparo) começa justamente nelas. Medido no Playground do
// Trabalhista: com "Vi que você marcou: Pedi demissão. Qual foi a data em que
// isso aconteceu?" descartada, o modelo via só "foi dia 20 de outubro" e
// perguntava de novo se ela pediu demissão ou foi demitida. A OpenAI aceita a
// conversa começando no assistente e não passa por aqui.
//
// Em vez de descartar, uma NOTA no papel de usuário abre a conversa, dizendo
// por escrito que não é o cliente (a forma da nota da retomada,
// `comNotaDaRetomada`). Sem nenhuma fala do cliente, fica o comportamento de
// antes (a nota de "ainda não escreveu" no lugar de tudo): a conversa que
// termina num turno do modelo é recusada pelo Gemini e CONTINUADA pela
// Anthropic.
// ============================================================

/** Abre a conversa aberta pelo escritório, antes das mensagens nossas. */
export const NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO =
  '[System note, not a message from the customer: the business started this conversation, ' +
  'so the first messages below were sent by the business before the customer wrote anything.]'

/** A conversa sem nenhuma fala do cliente (a de sempre dos adaptadores). */
export const NOTA_SEM_MENSAGEM_DO_CLIENTE = '(The customer has not sent a message yet.)'

/**
 * Funde os turnos consecutivos e faz a conversa começar no cliente sem perder
 * as mensagens do escritório que vieram antes da primeira fala dele.
 */
export function comecarNoCliente(messages: readonly ChatMessage[]): ChatMessage[] {
  const fundidas = mergeConsecutive([...messages])
  if (!fundidas.some((m) => m.role === 'user')) {
    return [{ role: 'user', content: NOTA_SEM_MENSAGEM_DO_CLIENTE }]
  }
  if (fundidas[0].role === 'assistant') {
    return [{ role: 'user', content: NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO }, ...fundidas]
  }
  return fundidas
}
