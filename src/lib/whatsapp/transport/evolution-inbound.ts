// ============================================================
// Evolution `messages.upsert` → NormalizedInbound.
//
// Baileys delivers a flat `{ key, pushName, message, messageTimestamp }`
// shape (very different from Meta's entry[].changes[].value envelope).
// Text arrives as `message.conversation` or
// `message.extendedTextMessage.text`; media as a typed sub-object whose
// `caption` (when present) is the text. Group chats (`@g.us`) and our own
// echoes (`key.fromMe`) are dropped — a 1:1 CRM inbox doesn't want them.
// ============================================================

import type { NormalizedInbound } from '@/lib/whatsapp/inbound-store';

export interface EvolutionMessageKey {
  remoteJid?: string;
  fromMe?: boolean;
  id?: string;
  participant?: string;
}

export interface EvolutionUpsert {
  key?: EvolutionMessageKey;
  pushName?: string;
  message?: Record<string, unknown> | null;
  messageType?: string;
  messageTimestamp?: number | string;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

/** Reduce a chat JID to digits-only phone (drops @suffix and device part). */
export function phoneFromJid(jid: string): string {
  return jid
    .replace(/@s\.whatsapp\.net$|@lid$|@g\.us$/, '')
    .replace(/:.*/, '')
    .replace(/\D/g, '');
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

export function extractText(message?: Record<string, unknown> | null): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  const ext = asRecord(message.extendedTextMessage);
  if (ext && typeof ext.text === 'string') return ext.text;
  for (const key of ['imageMessage', 'videoMessage', 'documentMessage']) {
    const m = asRecord(message[key]);
    if (m && typeof m.caption === 'string' && m.caption) return m.caption;
  }
  return null;
}

export function detectContentType(
  message?: Record<string, unknown> | null
): NormalizedInbound['contentType'] {
  if (!message) return 'text';
  if (message.imageMessage || message.stickerMessage) return 'image';
  if (message.videoMessage) return 'video';
  if (message.audioMessage) return 'audio';
  if (message.documentMessage) return 'document';
  if (message.locationMessage) return 'location';
  return 'text';
}

/**
 * Normalize one upsert item. Returns null for messages the inbox should
 * ignore (group chats, our own echoes, or missing key/id). `channelId` é o
 * `cb_channels.id` por onde a mensagem entrou (Fase 3), propagado para o
 * carimbo — NULL no fallback de transição.
 */
export function normalizeUpsert(
  item: EvolutionUpsert,
  accountId: string,
  configOwnerUserId: string,
  channelId: string | null = null
): NormalizedInbound | null {
  const jid = item.key?.remoteJid;
  const id = item.key?.id;
  if (!jid || !id) return null;
  if (item.key?.fromMe) return null; // our own send, echoed back
  if (isGroupJid(jid)) return null; // 1:1 inbox only (for now)

  const phone = phoneFromJid(jid);
  if (!phone) return null;

  const ts =
    typeof item.messageTimestamp === 'number'
      ? item.messageTimestamp
      : typeof item.messageTimestamp === 'string'
        ? parseInt(item.messageTimestamp, 10) || Math.floor(Date.now() / 1000)
        : Math.floor(Date.now() / 1000);

  return {
    accountId,
    configOwnerUserId,
    channelId,
    phone,
    name: item.pushName || phone,
    providerMessageId: id,
    remoteJid: jid,
    timestamp: ts,
    contentType: detectContentType(item.message),
    text: extractText(item.message),
    // Preenchido pelo webhook, que tem as credenciais para chamar
    // chat/getBase64FromMediaMessage — ver evolution-media.ts.
    mediaUrl: null,
  };
}
