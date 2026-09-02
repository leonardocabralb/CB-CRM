// ============================================================
// Transport-agnostic inbound-message persistence.
//
// Mirrors the Meta webhook's `processMessage` (find/create contact +
// conversation, insert the message, bump the conversation, then fan out
// to flows / automations / AI auto-reply / outbound webhooks) but takes a
// already-normalized message so any transport (Evolution now, Meta later)
// can reuse it. The race-safe find-or-create logic matches the Meta
// webhook exactly by sharing `findExistingContact` + the unique-violation
// re-resolve (issues #212, #363).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { routeContactToPipeline } from '@/lib/cb-channels/pipeline-routing';
import { reopenClosedConversation } from '@/lib/conversations/reopen';
import { runAutomationsForTrigger } from '@/lib/automations/engine';
import { dispatchInboundToFlows } from '@/lib/flows/engine';
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import {
  stampMessageChannel,
  followConversationChannel,
} from '@/lib/cb-channels/stamp';

/** A message from any transport, reduced to what persistence needs. */
export interface NormalizedInbound {
  accountId: string;
  /** NOT NULL audit FK for created contact/conversation rows. */
  configOwnerUserId: string;
  /**
   * `cb_channels.id` do canal por onde a mensagem entrou (Fase 3). NULL no
   * fallback de transição (whatsapp_config) — aí não há carimbo nem follow.
   */
  channelId?: string | null;
  /**
   * A mensagem saiu DESTA conta de WhatsApp — ou é o eco do que o CRM
   * enviou, ou foi digitada no celular pareado. Quem chama resolve a
   * ambiguidade pelo `providerMessageId` e usa `persistDeviceMessage` no
   * segundo caso; `persistInboundMessage` assume mensagem DO CLIENTE.
   */
  fromMe?: boolean;
  /** Sender phone (any form — normalized on store). */
  phone: string;
  /** Display name (pushName / profile name), falls back to phone. */
  name: string;
  /** Provider message id (Baileys key.id / Meta wamid) → messages.message_id. */
  providerMessageId: string;
  /** Baileys chat JID, for later reaction/reply-key reconstruction. */
  remoteJid?: string;
  /**
   * Endereço `@lid` da conversa, quando a Evolution reescreveu `remoteJid`
   * para o telefone. É o endereço para AGIR sobre a mensagem (revogar,
   * editar); `remoteJid` é o para IDENTIFICAR a conversa. Migration 917.
   */
  remoteJidLid?: string | null;
  /** Unix seconds. */
  timestamp: number;
  contentType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location';
  text: string | null;
  mediaUrl?: string | null;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'text',
  'image',
  'document',
  'audio',
  'video',
  'location',
  'template',
  'interactive',
]);

interface ContactRow {
  id: string;
  name: string;
  [k: string]: unknown;
}

async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  phone: string,
  name: string
): Promise<{ contact: ContactRow; wasCreated: boolean } | null> {
  // ⚠️ `falhou` deliberadamente NÃO derruba a ingestão (mesma decisão do
  // webhook da Meta): perder a mensagem do cliente é pior que arriscar uma
  // ficha duplicada de variante de tronco — o backstop 23505 abaixo cobre o
  // duplicado exato. Caminhos de GENTE respondem 500 em vez disso.
  const existing = (await findExistingContact(db, accountId, phone)).contato;
  if (existing) {
    if (name && name !== existing.name) {
      await db
        .from('contacts')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    }
    return { contact: existing as ContactRow, wasCreated: false };
  }

  const { data: created, error } = await db
    .from('contacts')
    .insert({ account_id: accountId, user_id: ownerUserId, phone, name: name || phone })
    .select()
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = (await findExistingContact(db, accountId, phone)).contato;
      if (raced) return { contact: raced as ContactRow, wasCreated: false };
    }
    console.error('[inbound-store] create contact failed:', error);
    return null;
  }
  return { contact: created as ContactRow, wasCreated: true };
}

async function findOrCreateConversation(
  db: SupabaseClient,
  accountId: string,
  ownerUserId: string,
  contactId: string
): Promise<{ conversation: { id: string; unread_count?: number }; created: boolean } | null> {
  const { data: rows, error } = await db
    .from('conversations')
    .select('*')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('created_at', { ascending: true })
    .limit(1);

  if (error) {
    console.error('[inbound-store] find conversation failed:', error);
    return null;
  }
  if (rows && rows.length > 0) return { conversation: rows[0], created: false };

  const { data: created, error: createError } = await db
    .from('conversations')
    .insert({ account_id: accountId, user_id: ownerUserId, contact_id: contactId })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await db
        .from('conversations')
        .select('*')
        .eq('account_id', accountId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) return { conversation: raced[0], created: false };
    }
    console.error('[inbound-store] create conversation failed:', createError);
    return null;
  }
  return { conversation: created, created: true };
}

/** Identificadores do que foi gravado, para o chamador completar depois. */
export interface PersistedInbound {
  messageId: string;
  conversationId: string;
}

/**
 * Grava uma mensagem que o operador enviou PELO CELULAR pareado, não pelo
 * CRM. Existe separada de `persistInboundMessage` de propósito, e a
 * diferença não é cosmética:
 *
 *  - **Nenhum MOTOR DE CONVERSA.** Automação, flow e resposta de IA não
 *    podem disparar aqui. Se disparassem, o assistente responderia ao
 *    próprio advogado, e uma automação de "primeira mensagem" contaria a
 *    resposta dele como se fosse do cliente.
 *
 *    ⚠️ O funil e o canal da conversa são OUTRA coisa, e por isso rodam
 *    (desde 2026-08-31). Nenhum dos dois fala com o cliente nem produz
 *    mensagem: um arquiva "este contato virou trabalho", o outro registra
 *    "a conversa está acontecendo neste número". Eram a lacuna que fazia o
 *    caminho REAL do escritório — 1.041 mensagens pelo celular contra 8
 *    pelo CRM — não abrir negócio nenhum.
 *  - **Não mexe em `unread_count`.** O operador acabou de escrever aquilo;
 *    marcar como não lido é o contrário do que aconteceu.
 *  - **`sender_type='agent'`**, com `from_device` para a bolha marcar a
 *    origem.
 *
 * Um flag dentro de `persistInboundMessage` foi descartado justamente
 * porque o risco é o esquecimento: uma função que NÃO chama o fan-out não
 * tem como fanar por engano.
 */
export async function persistDeviceMessage(
  db: SupabaseClient,
  m: NormalizedInbound
): Promise<PersistedInbound | null> {
  const contactOutcome = await findOrCreateContact(
    db,
    m.accountId,
    m.configOwnerUserId,
    m.phone,
    // O `pushName` de uma mensagem `fromMe` é o nome do PRÓPRIO operador,
    // não o do cliente — usá-lo renomearia o contato para "Leonardo".
    ''
  );
  if (!contactOutcome) return null;

  const convResult = await findOrCreateConversation(
    db,
    m.accountId,
    m.configOwnerUserId,
    contactOutcome.contact.id
  );
  if (!convResult) return null;
  const conversation = convResult.conversation;

  const contentType = ALLOWED_CONTENT_TYPES.has(m.contentType) ? m.contentType : 'text';

  const { data: insertedMsg, error } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'agent',
      content_type: contentType,
      content_text: m.text,
      media_url: m.mediaUrl ?? null,
      message_id: m.providerMessageId,
      remote_jid: m.remoteJid ?? null,
      // Endereço para AGIR sobre a mensagem quando a conversa migrou para
      // LID — ver migration 917. NULL é o caso normal.
      remote_jid_lid: m.remoteJidLid ?? null,
      from_me: true,
      from_device: true,
      // Saiu do aparelho, logo o WhatsApp já a entregou à rede. O ACK
      // (messages.update) refina para delivered/read depois.
      status: 'sent',
      channel_id: m.channelId ?? null,
      created_at: new Date(m.timestamp * 1000).toISOString(),
    })
    .select('id')
    .single();

  if (error || !insertedMsg) {
    console.error('[inbound-store] insert device message failed:', error);
    return null;
  }

  await db
    .from('conversations')
    .update({
      last_message_text: m.text || `[${m.contentType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  // A equipe falou numa conversa encerrada: ela volta à caixa de entrada.
  // Sem responsável — não há usuário do CRM por trás do celular pareado
  // (`sender_id` nulo), só um advogado digitando. Ver `reopen.ts`.
  await reopenClosedConversation(db, conversation);

  // A conversa segue o número por onde a EQUIPE acabou de falar — a mesma
  // regra que já valia quando quem escrevia era o cliente, e o mesmo
  // `followConversationChannel`, que não faz nada se o atendente tiver
  // FIXADO o canal no seletor do fio (`channel_pinned`).
  //
  // ⚠️ Sem isto a conversa nascia com `channel_id` NULO — 129 delas em
  // produção —, e conversa sem canal cai no canal PADRÃO da conta na hora de
  // responder. O efeito medido: o advogado abordava o cliente pelo número do
  // Jurídico e o CRM responderia pelo Comercial, trocando a identidade do
  // escritório no meio do atendimento. A mensagem já nasce carimbada no
  // insert acima; o que faltava era a conversa.
  await followConversationChannel(db, conversation.id, m.channelId ?? null);

  // Funil padrão da conexão — ver o cabeçalho de `pipeline-routing.ts`.
  // Nunca lança, e sai no primeiro SELECT quando a conexão não tem funil.
  await routeContactToPipeline({
    db,
    accountId: m.accountId,
    channelId: m.channelId ?? null,
    contactId: contactOutcome.contact.id,
    // O nome do contato como está NO BANCO. O `m.name` de uma mensagem
    // `fromMe` é o nome do PRÓPRIO operador (é por isso que o
    // `findOrCreateContact` acima recebe string vazia) — usá-lo aqui poria
    // "Leonardo" no título de um card que é do cliente.
    contactName: contactOutcome.contact.name ?? null,
    conversationId: conversation.id,
  });

  return { messageId: insertedMsg.id, conversationId: conversation.id };
}

/**
 * Persist an inbound message and drive the downstream engines. Safe to
 * call inside a route's `after()` — every fan-out owns its try/catch and
 * never throws. Media resolution (mediaUrl) is the caller's job.
 *
 * Devolve os ids do que foi gravado (ou `null` quando desistiu no meio) para
 * que o chamador possa **anexar a mídia DEPOIS**. O caminho antigo resolvia a
 * mídia antes de chamar aqui, e com isso uma falha de download levava junto a
 * mensagem inteira — ver o comentário no webhook da Evolution.
 */
export async function persistInboundMessage(
  db: SupabaseClient,
  m: NormalizedInbound
): Promise<PersistedInbound | null> {
  const contactOutcome = await findOrCreateContact(
    db,
    m.accountId,
    m.configOwnerUserId,
    m.phone,
    m.name
  );
  if (!contactOutcome) return null;
  const contact = contactOutcome.contact;

  const convResult = await findOrCreateConversation(
    db,
    m.accountId,
    m.configOwnerUserId,
    contact.id
  );
  if (!convResult) return null;
  const conversation = convResult.conversation;

  if (convResult.created) {
    await dispatchWebhookEvent(db, m.accountId, 'conversation.created', {
      conversation_id: conversation.id,
      contact_id: contact.id,
      // Sem o canal, N números viram um stream indistinguível para quem
      // integra: não dá para rotear "só o que entrar pelo Comercial".
      channel_id: m.channelId ?? null,
    });
  }

  const contentType = ALLOWED_CONTENT_TYPES.has(m.contentType) ? m.contentType : 'text';

  const { count: priorCustomerMsgCount } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('sender_type', 'customer');
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const { data: insertedMsg, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'customer',
      content_type: contentType,
      content_text: m.text,
      media_url: m.mediaUrl ?? null,
      message_id: m.providerMessageId,
      remote_jid: m.remoteJid ?? null,
      // Endereço para AGIR sobre a mensagem quando a conversa migrou para
      // LID — ver migration 917. NULL é o caso normal.
      remote_jid_lid: m.remoteJidLid ?? null,
      from_me: false,
      status: 'delivered',
      created_at: new Date(m.timestamp * 1000).toISOString(),
    })
    .select('id')
    .single();
  // `!insertedMsg` junto com o erro: sem ele o id abaixo seria `string |
  // undefined` e o chamador não teria onde pendurar o anexo.
  if (msgError || !insertedMsg) {
    console.error('[inbound-store] insert message failed:', msgError);
    return null;
  }

  await db
    .from('conversations')
    .update({
      last_message_text: m.text || `[${m.contentType}]`,
      last_message_at: new Date().toISOString(),
      unread_count: (conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  // O cliente escreveu de novo numa conversa encerrada: ela volta à caixa de
  // entrada (paridade com o webhook da Meta — até 2026-09-02 só ele reabria,
  // e produção roda Evolution). Ver `reopen.ts`.
  await reopenClosedConversation(db, conversation);

  // Carimbo de canal (Fase 3): marca por onde a mensagem entrou e faz a
  // conversa "seguir o cliente" (a menos que fixada). Best-effort e
  // deploy-safe — nunca afeta o insert acima nem o fan-out abaixo.
  if (m.channelId) {
    await stampMessageChannel(db, insertedMsg.id, m.channelId);
    await followConversationChannel(db, conversation.id, m.channelId);
  }

  // ---- downstream engines (parity with the Meta webhook) ----
  const inboundText = m.text ?? '';

  const flowResult = await dispatchInboundToFlows({
    accountId: m.accountId,
    userId: m.configOwnerUserId,
    contactId: contact.id,
    conversationId: conversation.id,
    channelId: m.channelId ?? null,
    message: {
      kind: 'text',
      text: inboundText,
      meta_message_id: m.providerMessageId,
    },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const triggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = [];
  if (!flowConsumed) triggers.push('new_message_received', 'keyword_match');
  if (contactOutcome.wasCreated) triggers.unshift('new_contact_created');
  if (isFirstInboundMessage) triggers.unshift('first_inbound_message');
  // ⚠️ AGUARDADAS, não fire-and-forget — ver o comentário gêmeo no webhook da
  // Meta. Solto, o SELECT do roteador de funil (abaixo) corre antes do INSERT
  // do passo `create_deal` de automação e os dois criam card no mesmo funil.
  const disparosDeAutomacao: Promise<void>[] = [];
  for (const triggerType of triggers) {
    disparosDeAutomacao.push(
      runAutomationsForTrigger({
        accountId: m.accountId,
        triggerType,
        contactId: contact.id,
        context: {
          message_text: inboundText,
          conversation_id: conversation.id,
          channel_id: m.channelId ?? null,
        },
      }).catch((err) => console.error('[inbound-store] automation dispatch failed:', err)),
    );
  }
  await Promise.allSettled(disparosDeAutomacao);

  // Funil padrão da conexão. Fora do laço de automações de propósito: o
  // gatilho aqui é por ESTADO ("este contato já tem card neste funil?"), não
  // por evento, porque `first_inbound_message` é contado por conversa e há
  // uma conversa por contato — o cliente que muda de número nunca dispararia.
  // `routeContactToPipeline` nunca lança e sai no primeiro SELECT quando a
  // conexão não tem funil configurado.
  await routeContactToPipeline({
    db,
    accountId: m.accountId,
    channelId: m.channelId ?? null,
    contactId: contact.id,
    contactName: contact.name ?? null,
    conversationId: conversation.id,
  });

  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId: m.accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId: m.configOwnerUserId,
      channelId: m.channelId ?? null,
    });
  }

  await dispatchWebhookEvent(db, m.accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contact.id,
    whatsapp_message_id: m.providerMessageId,
    content_type: contentType,
    text: m.text,
    channel_id: m.channelId ?? null,
  });

  return { messageId: insertedMsg.id, conversationId: conversation.id };
}
