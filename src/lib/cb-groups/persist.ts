// ============================================================
// Persistência de mensagem de GRUPO.
//
// ⚠️ NENHUM FAN-OUT AQUI, E ISSO É A FEATURE.
// Automação, flow e resposta de IA não podem disparar em grupo (decisão de
// produto — ver 906_cb_grupos). A garantia não é um `if`: é o fato de este
// arquivo NÃO IMPORTAR os motores. Uma função que não chama não tem como
// chamar por engano — mesmo raciocínio que `persistDeviceMessage` já usa no
// `inbound-store.ts`, e pelo mesmo motivo: o risco real é o esquecimento.
//
// Se um dia grupos entrarem nas automações, o import entra aqui, deliberado
// e visível na revisão — não escondido atrás de uma flag que alguém liga sem
// perceber.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';
import type { NormalizedGroupInbound } from '@/lib/whatsapp/transport/evolution-group-inbound';

/** Tipos que `messages.content_type` aceita (CHECK da 906). */
const CONTENT_TYPES_OK = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
  'system',
]);

/**
 * Até este tamanho o anexo de grupo baixa sozinho na chegada; acima, fica
 * como "toque para baixar".
 *
 * O número vem de medição, não de chute: na sondagem de produção os anexos
 * reais de grupo tinham 38–205 KB, então o teto quase nunca é atingido e a
 * regra funciona como rede de segurança contra o vídeo ocasional. O motivo de
 * baixar por padrão é que o WhatsApp expira a mídia no servidor dele: anexo
 * não aberto a tempo é anexo perdido para sempre.
 */
export const LIMITE_DOWNLOAD_AUTOMATICO_BYTES = 5 * 1024 * 1024;

export interface PersistedGroupMessage {
  messageId: string;
  conversationId: string;
  groupId: string;
}

/**
 * Encontra ou cria a linha do grupo. `subject` NÃO é preenchido aqui: a
 * mensagem de grupo não carrega o nome, ele vem da sincronização (Fase 4).
 * Um grupo recém-nascido fica com `subject` NULL e a UI mostra "Grupo sem
 * nome" até a sincronização rodar.
 */
export async function findOrCreateGroup(
  db: SupabaseClient,
  accountId: string,
  channelId: string | null,
  groupJid: string,
): Promise<{ id: string } | null> {
  const buscar = async () => {
    const { data } = await db
      .from('cb_groups')
      .select('id')
      .eq('account_id', accountId)
      .eq('jid', groupJid)
      .maybeSingle();
    return data as { id: string } | null;
  };

  const existente = await buscar();
  if (existente) return existente;

  const { data: criado, error } = await db
    .from('cb_groups')
    .insert({ account_id: accountId, jid: groupJid, channel_id: channelId })
    .select('id')
    .single();

  if (error) {
    // Duas entregas simultâneas do webhook: o índice único
    // (account_id, jid) barra a segunda e a gente relê.
    if (isUniqueViolation(error)) {
      const corrida = await buscar();
      if (corrida) return corrida;
    }
    console.error('[cb-groups] criar grupo falhou:', error);
    return null;
  }
  return criado as { id: string };
}

/**
 * Conversa do grupo. `contact_id` fica NULL de propósito — o CHECK
 * `cb_conv_contato_xor_grupo` garante que é ou um ou outro.
 */
async function findOrCreateGroupConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  groupId: string,
): Promise<{ id: string; unread_count?: number } | null> {
  const buscar = async () => {
    const { data } = await db
      .from('conversations')
      .select('id, unread_count')
      .eq('account_id', accountId)
      .eq('group_id', groupId)
      .maybeSingle();
    return data as { id: string; unread_count?: number } | null;
  };

  const existente = await buscar();
  if (existente) return existente;

  const { data: criada, error } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, group_id: groupId })
    .select('id, unread_count')
    .single();

  if (error) {
    // O índice único (account_id, group_id) da 906 é o que faz esta
    // recuperação existir — sem ele a corrida criaria duas conversas.
    if (isUniqueViolation(error)) {
      const corrida = await buscar();
      if (corrida) return corrida;
    }
    console.error('[cb-groups] criar conversa de grupo falhou:', error);
    return null;
  }
  return criada as { id: string; unread_count?: number };
}

/**
 * Aprende o NOSSO lid observando uma mensagem que saiu deste número dentro de
 * um grupo: ali o `participant` somos nós. Sem isto, `mentions_us` seria
 * sempre false, porque as menções chegam em LID e o que temos guardado é
 * telefone (ver 916_cb_lid_do_canal).
 *
 * Best-effort e só escreve uma vez — falhar aqui não pode derrubar a
 * gravação da mensagem.
 */
export async function aprenderNossoLid(
  db: SupabaseClient,
  channelId: string,
  senderJid: string | null,
): Promise<void> {
  if (!senderJid || !senderJid.endsWith('@lid')) return;
  const { error } = await db
    .from('cb_channels')
    .update({ own_lid: senderJid })
    .eq('id', channelId)
    .is('own_lid', null);
  if (error) console.warn('[cb-groups] gravar own_lid falhou (ignorado):', error.message);
}

/** Marcaram a gente? Sem `own_lid` conhecido a resposta é honesta: não sei, logo false. */
export function mencionaNos(mentionedJids: string[], ownLid: string | null): boolean {
  if (!ownLid) return false;
  return mentionedJids.includes(ownLid);
}

interface GravarArgs {
  db: SupabaseClient;
  m: NormalizedGroupInbound;
  /** `cb_channels.own_lid`, para resolver as menções. */
  ownLid?: string | null;
  /** Payload cru do Baileys, para buscar o anexo depois. */
  mediaRef?: unknown;
}

/**
 * Grava uma mensagem que ALGUÉM DO GRUPO enviou.
 *
 * Anexo NÃO é baixado aqui: a mensagem nasce com `media_state='pending'` e o
 * webhook decide depois (baixa até 5 MB, deixa pendente acima disso). É a
 * mesma separação em duas fases que já protege o 1:1 — gravar primeiro
 * garante que um download lento nunca faça a mensagem sumir.
 */
export async function persistGroupMessage(
  args: GravarArgs,
): Promise<PersistedGroupMessage | null> {
  const { db, m, ownLid = null, mediaRef } = args;

  const grupo = await findOrCreateGroup(db, m.accountId, m.channelId, m.groupJid);
  if (!grupo) return null;

  const conversa = await findOrCreateGroupConversation(
    db,
    m.accountId,
    m.configOwnerUserId,
    grupo.id,
  );
  if (!conversa) return null;

  const temAnexo = m.contentType !== 'text' && m.contentType !== 'location';
  const contentType = CONTENT_TYPES_OK.has(m.contentType) ? m.contentType : 'text';

  const { data: gravada, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversa.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: m.text,
      message_id: m.providerMessageId,
      remote_jid: m.groupJid,
      from_me: false,
      status: 'delivered',
      group_sender_jid: m.senderJid,
      group_sender_name: m.senderName,
      mentions_us: mencionaNos(m.mentionedJids, ownLid),
      media_state: temAnexo ? 'pending' : null,
      // Inline, e não via `stampMessageChannel`: aquele helper faz um UPDATE
      // separado para ser seguro se a migration 902 ainda não tivesse rodado.
      // Este caminho só existe a partir da 906, muito depois — então o
      // carimbo cabe no próprio insert, com uma ida a menos ao banco.
      channel_id: m.channelId ?? null,
      created_at: new Date(m.timestamp * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error || !gravada) {
    console.error('[cb-groups] inserir mensagem de grupo falhou:', error);
    return null;
  }

  if (temAnexo && mediaRef) {
    const { error: refErr } = await db
      .from('cb_message_media_ref')
      .insert({ message_id: gravada.id, account_id: m.accountId, payload: mediaRef });
    // Sem o ponteiro o anexo é irrecuperável, mas a mensagem em si já está
    // gravada — vale mais que o anexo.
    if (refErr) console.error('[cb-groups] guardar ponteiro da mídia falhou:', refErr.message);
  }

  await db
    .from('conversations')
    .update({
      last_message_text: previaDaMensagem(m),
      last_message_at: new Date().toISOString(),
      unread_count: (conversa.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversa.id);

  // ⚠️ A conversa NÃO "segue o cliente", de propósito. No 1:1 esse
  // comportamento aponta a conversa para o número por onde o cliente acabou de
  // escrever. Num grupo ele trocaria a identidade de resposta toda vez que um
  // participante diferente falasse — o grupo é um só, o canal também.

  return { messageId: gravada.id, conversationId: conversa.id, groupId: grupo.id };
}

/**
 * Grava uma mensagem que NÓS enviamos no grupo pelo celular pareado.
 *
 * Espelha `persistDeviceMessage` do 1:1: `sender_type='agent'`,
 * `from_device`, e **não mexe no não-lido** — o operador acabou de escrever
 * aquilo, marcar como não lido é o contrário do que aconteceu.
 */
export async function persistGroupDeviceMessage(
  args: GravarArgs,
): Promise<PersistedGroupMessage | null> {
  const { db, m, mediaRef } = args;

  const grupo = await findOrCreateGroup(db, m.accountId, m.channelId, m.groupJid);
  if (!grupo) return null;

  const conversa = await findOrCreateGroupConversation(
    db,
    m.accountId,
    m.configOwnerUserId,
    grupo.id,
  );
  if (!conversa) return null;

  const temAnexo = m.contentType !== 'text' && m.contentType !== 'location';
  const contentType = CONTENT_TYPES_OK.has(m.contentType) ? m.contentType : 'text';

  const { data: gravada, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversa.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: m.text,
      message_id: m.providerMessageId,
      remote_jid: m.groupJid,
      from_me: true,
      from_device: true,
      status: 'sent',
      // Quem escreveu somos nós; o nome do participante seria o do próprio
      // operador e a bolha já se identifica como nossa pelo `from_device`.
      group_sender_jid: m.senderJid,
      media_state: temAnexo ? 'pending' : null,
      channel_id: m.channelId ?? null,
      created_at: new Date(m.timestamp * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error || !gravada) {
    console.error('[cb-groups] inserir mensagem do aparelho no grupo falhou:', error);
    return null;
  }

  if (temAnexo && mediaRef) {
    const { error: refErr } = await db
      .from('cb_message_media_ref')
      .insert({ message_id: gravada.id, account_id: m.accountId, payload: mediaRef });
    if (refErr) console.error('[cb-groups] guardar ponteiro da mídia falhou:', refErr.message);
  }

  await db
    .from('conversations')
    .update({
      last_message_text: previaDaMensagem(m),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversa.id);

  return { messageId: gravada.id, conversationId: conversa.id, groupId: grupo.id };
}

/** Texto da prévia na lista do inbox. */
function previaDaMensagem(m: NormalizedGroupInbound): string {
  const corpo = m.text || `[${m.contentType}]`;
  // Em grupo, saber QUEM falou é metade da informação — sem isso a lista
  // mostra frases soltas sem dono.
  return m.senderName ? `${m.senderName}: ${corpo}` : corpo;
}
