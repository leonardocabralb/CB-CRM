// ============================================================
// Prévia da conversa (`conversations.last_message_text`).
//
// Vive aqui, e não dentro de uma rota, porque DOIS caminhos precisam dela e
// eles estão em arquivos diferentes: a edição feita pelo operador (rota
// /api/whatsapp/message) e a confirmação de exclusão que chega pelo webhook
// da Evolution.
//
// Faltar o segundo é defeito visível: a bolha vira "Apagada" e a lista do
// inbox segue mostrando o texto retratado como última mensagem — para todo o
// escritório, enquanto aquela for a última da conversa. Vale tanto para a
// exclusão que o CRM pediu quanto para a que o contato fez.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Reescreve a prévia quando a mensagem alterada é a ÚLTIMA da conversa.
 *
 * Só olha `deleted_at` (exclusão CONFIRMADA). Um pedido sem confirmação não
 * muda a prévia de propósito: enquanto não se sabe se a mensagem saiu do
 * aparelho do contato, o texto continua sendo o registro do que foi dito.
 *
 * `db` precisa de service-role — quem chama já autorizou o acesso.
 */
export async function atualizarPreviaDaConversa(
  db: SupabaseClient,
  conversationId: string,
): Promise<void> {
  const { data: ultima } = await db
    .from('messages')
    .select('content_text, content_type, deleted_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!ultima) return;
  const previa = ultima.deleted_at
    ? '[mensagem apagada]'
    : ultima.content_text || `[${ultima.content_type}]`;
  await db
    .from('conversations')
    .update({ last_message_text: previa, updated_at: new Date().toISOString() })
    // `updated_at` não reordena a lista: ela ordena por `last_message_at`.
    .eq('id', conversationId);
}
