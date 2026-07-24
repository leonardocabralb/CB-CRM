// ============================================================
// Carimbo de canal em mensagens/conversas (Fase 3).
//
// SEGURO PARA DEPLOY FORA DE ORDEM: os UPDATEs abaixo engolem o erro do
// PostgREST. Se a migration 902 (colunas `channel_id` / `channel_pinned`)
// ainda não rodou, o carimbo simplesmente não acontece e o fluxo de
// mensagens segue intacto — o carimbo NUNCA está no caminho crítico do
// insert da mensagem (que roda antes e sozinho).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Marca por qual canal esta mensagem passou (`messages.channel_id`). No-op
 * quando `channelId` é null (fallback de transição / conta sem canal).
 */
export async function stampMessageChannel(
  db: SupabaseClient,
  messageRowId: string,
  channelId: string | null,
): Promise<void> {
  if (!channelId) return;
  const { error } = await db
    .from('messages')
    .update({ channel_id: channelId })
    .eq('id', messageRowId);
  if (error) {
    console.warn(
      '[cb-channels] carimbo de canal na mensagem falhou (ignorado):',
      error.message,
    );
  }
}

/**
 * "Segue o cliente": aponta a conversa para o canal por onde o cliente acabou
 * de escrever, para a próxima resposta sair pelo mesmo número. Só atua quando
 * o atendente NÃO fixou o canal (`channel_pinned = false`). No-op quando
 * `channelId` é null (fallback de transição — não sobrescreve com nada).
 */
export async function followConversationChannel(
  db: SupabaseClient,
  conversationId: string,
  channelId: string | null,
): Promise<void> {
  if (!channelId) return;
  const { error } = await db
    .from('conversations')
    .update({ channel_id: channelId })
    .eq('id', conversationId)
    .eq('channel_pinned', false);
  if (error) {
    console.warn(
      '[cb-channels] follow de canal na conversa falhou (ignorado):',
      error.message,
    );
  }
}
