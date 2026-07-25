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
  /** Sender phone (any form — normalized on store). */
  phone: string;
  /** Display name (pushName / profile name), falls back to phone. */
  name: string;
  /** Provider message id (Baileys key.id / Meta wamid) → messages.message_id. */
  providerMessageId: string;
  /** Baileys chat JID, for later reaction/reply-key reconstruction. */
  remoteJid?: string;
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
  const existing = await findExistingContact(db, accountId, phone);
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
      const raced = await findExistingContact(db, accountId, phone);
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

/**
 * Persist an inbound message and drive the downstream engines. Safe to
 * call inside a route's `after()` — every fan-out owns its try/catch and
 * never throws. Media resolution (mediaUrl) is the caller's job.
 */
export async function persistInboundMessage(
  db: SupabaseClient,
  m: NormalizedInbound
): Promise<void> {
  const contactOutcome = await findOrCreateContact(
    db,
    m.accountId,
    m.configOwnerUserId,
    m.phone,
    m.name
  );
  if (!contactOutcome) return;
  const contact = contactOutcome.contact;

  const convResult = await findOrCreateConversation(
    db,
    m.accountId,
    m.configOwnerUserId,
    contact.id
  );
  if (!convResult) return;
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
      from_me: false,
      status: 'delivered',
      created_at: new Date(m.timestamp * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (msgError) {
    console.error('[inbound-store] insert message failed:', msgError);
    return;
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

  // Carimbo de canal (Fase 3): marca por onde a mensagem entrou e faz a
  // conversa "seguir o cliente" (a menos que fixada). Best-effort e
  // deploy-safe — nunca afeta o insert acima nem o fan-out abaixo.
  if (m.channelId && insertedMsg) {
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
  for (const triggerType of triggers) {
    runAutomationsForTrigger({
      accountId: m.accountId,
      triggerType,
      contactId: contact.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        channel_id: m.channelId ?? null,
      },
    }).catch((err) => console.error('[inbound-store] automation dispatch failed:', err));
  }

  if (!flowConsumed && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId: m.accountId,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId: m.configOwnerUserId,
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
}
