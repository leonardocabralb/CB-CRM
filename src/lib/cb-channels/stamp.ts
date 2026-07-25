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

/**
 * FIXA o canal da conversa por escolha explícita (API pública, seletor do
 * inbox, primeiro contato pela ficha). Diferente de
 * {@link followConversationChannel}, que só acompanha o cliente enquanto
 * ninguém fixou: aqui a escolha é do operador/integrador e passa a valer
 * mesmo que o cliente escreva por outro número.
 *
 * Valida a posse do canal antes de gravar — `channelId` vindo de request
 * externo não pode apontar para canal de outra conta.
 *
 * @returns `true` se fixou; `false` se o canal não pertence à conta.
 */
export async function pinConversationChannel(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  channelId: string,
): Promise<boolean> {
  const { data: canal, error: lookupError } = await db
    .from('cb_channels')
    .select('id')
    .eq('id', channelId)
    .eq('account_id', accountId)
    .maybeSingle();

  if (lookupError || !canal) return false;

  const { error } = await db
    .from('conversations')
    .update({ channel_id: channelId, channel_pinned: true })
    .eq('id', conversationId)
    .eq('account_id', accountId);

  if (error) {
    console.warn(
      '[cb-channels] fixar canal na conversa falhou (ignorado):',
      error.message,
    );
    return false;
  }
  return true;
}
