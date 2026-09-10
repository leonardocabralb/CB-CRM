// ============================================================
// Carimbo de canal em mensagens/conversas (Fase 3).
//
// SEGURO PARA DEPLOY FORA DE ORDEM: os UPDATEs abaixo engolem o erro do
// PostgREST. Se a migration 902 (colunas `channel_id` / `channel_pinned`)
// ainda não rodou, o carimbo simplesmente não acontece e o fluxo de
// mensagens segue intacto — o carimbo NUNCA está no caminho crítico do
// insert da mensagem (que roda antes e sozinho).
//
// ⚠️ A ENTRADA não usa mais `stampMessageChannel` (10/09/2026): o webhook da
// Meta e o `persistInboundMessage` da Evolution gravam `channel_id` no
// PRÓPRIO insert, por `gravarComCanal` (abaixo), como o grupo e o
// `persistDeviceMessage` já faziam. Mensagem de cliente que ficava sem carimbo
// quando este UPDATE falhava era lida pela janela de 24h por número como
// vinda de outro número. O helper segue nos envios (núcleo, robô), onde a
// mensagem é nossa e não abre janela.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** O erro do PostgREST no formato que importa aqui. */
interface ErroDoBanco {
  code?: string;
  message?: string;
  details?: string;
}

/**
 * O insert estourou a FK de `messages.channel_id` → `cb_channels(id)` (902)?
 * Só ESSA: violação da FK de `conversation_id` ou de `reply_to_message_id`
 * também é 23503, e repeti-la sem canal mascararia defeito de verdade.
 */
export function violouFkDoCanal(error: ErroDoBanco | null | undefined): boolean {
  if (!error || error.code !== '23503') return false;
  const texto = `${error.message ?? ''} ${error.details ?? ''}`;
  return texto.includes('messages_channel_id_fkey') || texto.includes('(channel_id)');
}

/**
 * Grava a mensagem RECEBIDA com o canal no próprio insert — com a rede de
 * segurança da FK.
 *
 * O canal é resolvido ANTES, às vezes segundos antes (atrás do download de um
 * anexo, ou dos fluxos e da IA do item anterior do lote). Se a conexão for
 * apagada nesse intervalo, o insert com o canal antigo estoura 23503 — e a
 * mensagem do cliente se PERDERIA: os provedores já receberam 200 e ninguém
 * reenvia. Aqui a gravação é repetida SEM canal, que é o estado que o
 * `ON DELETE SET NULL` da 902 deixaria um instante depois (achado da revisão
 * do PR #192). Enquanto o canal ia num UPDATE separado, esse caso só fazia o
 * carimbo falhar em silêncio.
 *
 * Devolve o resultado que valeu e o canal que FICOU gravado (nulo depois da
 * repetição): quem chama usa esse canal para a conversa seguir o cliente.
 */
export async function gravarComCanal<
  // O tipo da resposta sai de `Awaited<ReturnType<F>>`, que é o que o `await`
  // do próprio query builder do Supabase produz. Inferir `R` de
  // `PromiseLike<R>` falha com o `then` genérico do builder e cai no limite
  // da restrição — o chamador perderia o `data`.
  F extends (canal: string | null) => PromiseLike<{ error: ErroDoBanco | null }>,
>(
  channelId: string | null,
  gravar: F,
): Promise<{ resultado: Awaited<ReturnType<F>>; canal: string | null }> {
  const primeiro = await gravar(channelId);
  if (channelId !== null && violouFkDoCanal(primeiro.error)) {
    console.warn(
      '[cb-channels] a conexão sumiu durante a entrada; mensagem gravada sem canal:',
      channelId,
    );
    const semCanal = await gravar(null);
    return { resultado: semCanal as Awaited<ReturnType<F>>, canal: null };
  }
  return { resultado: primeiro as Awaited<ReturnType<F>>, canal: channelId };
}

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
