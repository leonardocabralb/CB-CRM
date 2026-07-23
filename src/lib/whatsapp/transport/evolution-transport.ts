// ============================================================
// Evolution implementation of WhatsAppTransport.
//
// Adapts the app's transport-neutral calls to the Evolution HTTP client:
//   * recipients are normalized to digits-only (Baileys `number` form),
//   * a `ProviderMessageRef` becomes a Baileys message key for
//     quote/reaction/read,
//   * the `audio` media kind routes to the dedicated voice-note endpoint,
//   * connection health maps Evolution's `open|connecting|close`.
//
// The Meta-only surface (templates, /register, WABA subscription,
// resumable upload, interactive buttons) is deliberately not here — see
// transport/types.ts for why.
// ============================================================

import { EvolutionClient, type EvolutionMessageKey } from './evolution-client';
import type {
  ConnectionState,
  InboundMedia,
  ProviderMessageRef,
  SendMediaArgs,
  SendPresenceArgs,
  SendReactionArgs,
  SendResult,
  SendTextArgs,
  WhatsAppTransport,
} from './types';

/**
 * Reduce any phone form (E.164 `+55 11 9…`, JID `…@s.whatsapp.net`) to
 * the digits-only string Evolution expects for `number`. Group JIDs
 * (`@g.us`) are returned unchanged so callers can detect/handle them.
 */
export function toEvolutionNumber(phoneOrJid: string): string {
  if (phoneOrJid.endsWith('@g.us')) return phoneOrJid;
  const bare = phoneOrJid.replace(/@s\.whatsapp\.net$|@lid$/, '');
  return bare.replace(/\D/g, '');
}

/** Rebuild a Baileys key from a stored reference, defaulting the JID from `to`. */
function toKey(
  ref: ProviderMessageRef,
  fallbackNumber?: string
): EvolutionMessageKey {
  const remoteJid =
    ref.remoteJid ??
    (fallbackNumber
      ? `${toEvolutionNumber(fallbackNumber)}@s.whatsapp.net`
      : '');
  return {
    id: ref.id,
    remoteJid,
    fromMe: ref.fromMe ?? true,
  };
}

export class EvolutionTransport implements WhatsAppTransport {
  readonly provider = 'evolution' as const;

  constructor(private readonly client: EvolutionClient) {}

  async sendText(args: SendTextArgs): Promise<SendResult> {
    const providerMessageId = await this.client.sendText({
      number: toEvolutionNumber(args.to),
      text: args.text,
      quoted: args.quoted ? toKey(args.quoted, args.to) : undefined,
    });
    return { providerMessageId };
  }

  async sendMedia(args: SendMediaArgs): Promise<SendResult> {
    const quoted = args.quoted ? toKey(args.quoted, args.to) : undefined;
    const number = toEvolutionNumber(args.to);

    // Audio is a voice note on Baileys — a distinct endpoint, no caption.
    if (args.kind === 'audio') {
      const providerMessageId = await this.client.sendAudio({
        number,
        audio: args.media,
        quoted,
      });
      return { providerMessageId };
    }

    const providerMessageId = await this.client.sendMedia({
      number,
      mediatype: args.kind,
      media: args.media,
      caption: args.caption,
      fileName: args.filename,
      quoted,
    });
    return { providerMessageId };
  }

  async sendReaction(args: SendReactionArgs): Promise<SendResult> {
    const providerMessageId = await this.client.sendReaction({
      key: toKey(args.target),
      reaction: args.emoji,
    });
    return { providerMessageId };
  }

  async markRead(targets: ProviderMessageRef[]): Promise<void> {
    if (targets.length === 0) return;
    await this.client.markMessageAsRead(targets.map((t) => toKey(t)));
  }

  async sendPresence(args: SendPresenceArgs): Promise<void> {
    await this.client.sendPresence({
      number: toEvolutionNumber(args.to),
      presence: args.presence,
    });
  }

  async fetchInboundMedia(message: unknown): Promise<InboundMedia> {
    const { base64, mimetype, fileName } =
      await this.client.getBase64FromMediaMessage({ message });
    return { base64, mimeType: mimetype, filename: fileName };
  }

  async getConnectionState(): Promise<{ state: ConnectionState }> {
    const res = await this.client.connectionState();
    const raw = res.instance?.state ?? res.state ?? 'close';
    const state: ConnectionState =
      raw === 'open' || raw === 'connecting' ? raw : 'close';
    return { state };
  }
}
