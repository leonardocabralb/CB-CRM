// ============================================================
// WhatsApp transport interface.
//
// The app was hardcoded to Meta Graph API v21.0 (see meta-api.ts).
// This interface is the seam that lets a second transport — the
// self-hosted Evolution API (Baileys) — coexist with Meta, selected
// per account by a `provider` discriminator on whatsapp_config.
//
// Every outbound path in the app (send-message.ts, flows/meta-send.ts,
// automations/meta-send.ts, broadcast-core.ts) already converges on the
// same three inputs — a connection, a recipient, and a payload — and
// diverges only in the HTTP shape. That convergence is what this
// interface captures: callers ask `getTransport(conn)` for a sender and
// stop caring which backend actually delivers the message.
//
// Design notes carried over from the two backends:
//   * Meta correlates status/reaction/reply by a single `wamid` string.
//     Evolution (Baileys) needs the FULL message key
//     `{ remoteJid, fromMe, id }`. So the shared reference type keeps
//     `remoteJid`/`fromMe` optional — Meta populates only `id`,
//     Evolution populates all three.
//   * `media` is a URL or a raw base64 string (no data: prefix). Meta
//     only accepts a public URL; Evolution accepts either.
// ============================================================

/** Media categories both backends can send. */
export type MediaKind = 'image' | 'video' | 'document' | 'audio';

/**
 * Everything needed to reference a previously-sent/received message
 * across the two backends. Meta needs only `id` (the wamid); Evolution
 * needs the whole Baileys key to target reactions, read receipts, and
 * reply-quoting. Persist all three on outbound sends (messages table)
 * so the Evolution path can reconstruct the key later.
 */
export interface ProviderMessageRef {
  /** Meta wamid, or Evolution/Baileys `key.id`. */
  id: string;
  /** Evolution only: the chat JID, e.g. `5511999999999@s.whatsapp.net`. */
  remoteJid?: string;
  /** Evolution only: whether the instance itself sent the target message. */
  fromMe?: boolean;
}

export interface SendResult {
  /** The backend's message id — a Meta wamid or a Baileys key.id. */
  providerMessageId: string;
}

export type ConnectionState = 'open' | 'connecting' | 'close';

export interface SendTextArgs {
  /** Recipient in the transport's expected form (E.164 for Meta, digits for Evolution — the impl normalizes). */
  to: string;
  text: string;
  /** Reply-quote target, if this is a reply. */
  quoted?: ProviderMessageRef;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  /** Public URL or raw base64 (no `data:` prefix). Meta requires a URL. */
  media: string;
  caption?: string;
  filename?: string;
  quoted?: ProviderMessageRef;
}

export interface SendReactionArgs {
  /** The message being reacted to. */
  target: ProviderMessageRef;
  /** Emoji to apply; empty string removes the reaction. */
  emoji: string;
}

export interface SendPresenceArgs {
  to: string;
  presence: 'composing' | 'recording' | 'paused';
}

/** Decoded inbound media, resolved on demand from a received message. */
export interface InboundMedia {
  /** Raw base64 (no `data:` prefix). */
  base64: string;
  mimeType: string;
  filename?: string;
}

/**
 * The stable contract every WhatsApp backend implements. Kept
 * deliberately small — only the operations that BOTH Meta and Evolution
 * (Baileys) can perform. Meta-only concepts (templates, HSM approval,
 * phone /register, WABA subscription, resumable media upload) are NOT
 * part of this interface; they live in the Meta implementation only and
 * are dropped from the Evolution path (see the migration plan).
 *
 * Interactive buttons/lists are intentionally absent: they are reliable
 * only on Meta and degrade to a numbered-text menu on Baileys, so the
 * caller composes that fallback as plain text rather than the transport
 * pretending to support a native button primitive on both.
 */
export interface WhatsAppTransport {
  readonly provider: 'meta' | 'evolution';

  sendText(args: SendTextArgs): Promise<SendResult>;
  sendMedia(args: SendMediaArgs): Promise<SendResult>;
  sendReaction(args: SendReactionArgs): Promise<SendResult>;

  /** Mark inbound messages as read (blue ticks). No-op where unsupported. */
  markRead(targets: ProviderMessageRef[]): Promise<void>;
  /** Typing / recording indicator. No-op where unsupported. */
  sendPresence(args: SendPresenceArgs): Promise<void>;

  /**
   * Resolve the bytes of an inbound media message. Meta uses a two-step
   * media-id → CDN download; Evolution decrypts the Baileys message to
   * base64. The `message` arg is the transport-native inbound payload.
   */
  fetchInboundMedia(message: unknown): Promise<InboundMedia>;

  /** Current connection health. Meta is always `open` once configured. */
  getConnectionState(): Promise<{ state: ConnectionState }>;
}
