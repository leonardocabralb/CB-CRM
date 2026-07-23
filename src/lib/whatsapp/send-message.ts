// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends to Meta (with phone-variant retry + contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic: it takes a `SupabaseClient` and an
// `accountId` and throws `SendMessageError` on failure. The callers
// own auth, rate-limiting, body parsing, and mapping the error to
// their respective response shapes (internal `{ error }` vs the v1
// envelope). Behaviour is identical to the original inline route —
// this is a straight extraction so the public endpoint can reuse it
// without duplicating ~250 lines of Meta plumbing.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendTextMessage,
  sendTemplateMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  type MediaKind,
} from '@/lib/whatsapp/meta-api';
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import {
  getTransport,
  toEvolutionNumber,
  type ProviderMessageRef,
} from '@/lib/whatsapp/transport';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Meta's `wamid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError('bad_request', 'message_type is required', 400);
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}"`,
      400
    );
  }

  if (messageType === 'text' && !contentText) {
    throw new SendMessageError(
      'bad_request',
      'content_text is required for text messages',
      400
    );
  }

  if (messageType === 'template' && !templateName) {
    throw new SendMessageError(
      'bad_request',
      'template_name is required for template messages',
      400
    );
  }

  // Interactive: validate the full structured payload against Meta's
  // limits up front so a bad payload 400s before we touch Meta.
  if (messageType === 'interactive') {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError('bad_request', result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      'bad_request',
      `media_url is required for ${messageType} messages`,
      400
    );
  }

  // Meta caps media captions at 1024 chars (audio carries none).
  if (
    isMediaKind &&
    messageType !== 'audio' &&
    typeof contentText === 'string' &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      'bad_request',
      'Caption exceeds the 1024-character limit',
      400
    );
  }
}

export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      'bad_request',
      'Contact phone number not found',
      400
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      'bad_request',
      'Invalid phone number format',
      400
    );
  }

  // Which number (channel) this conversation replies through. Resolves
  // the conversation's channel → the account default → whatsapp_config
  // fallback. Field names mirror whatsapp_config so the branches below
  // read the same. Behaviour is unchanged while only the default channel
  // exists (every conversation.channel_id is NULL → the default, which
  // the 901 backfill mirrored from whatsapp_config).
  const channel = await resolveChannelForConversation(db, accountId, conversation);

  if (!channel) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const provider = channel.provider;

  if (provider === 'meta' && (!channel.phone_number_id || !channel.access_token)) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp (Meta) connection is incomplete — reconfigure it in Settings.',
      400
    );
  }

  // Meta keeps its token in access_token; Evolution its instance key in
  // api_key. Only the Meta path decrypts here (and self-heals legacy CBC —
  // only for the whatsapp_config fallback; channels are GCM from creation).
  const accessToken = provider === 'meta' ? decrypt(channel.access_token!) : '';
  if (
    provider === 'meta' &&
    channel.source === 'whatsapp_config' &&
    channel.legacyConfigId &&
    isLegacyFormat(channel.access_token!)
  ) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', channel.legacyConfigId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve the reply target to its Meta message_id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let contextMessageId: string | undefined;
  let evolutionQuoted: ProviderMessageRef | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from('messages')
      .select('message_id, conversation_id, remote_jid, from_me')
      .eq('id', replyToMessageId)
      .eq('conversation_id', conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        'bad_request',
        'reply_to_message_id not found in this conversation',
        400
      );
    }
    if (!parent.message_id) {
      console.warn(
        '[send-message] reply target has no provider message id; sending without context'
      );
    } else {
      contextMessageId = parent.message_id;
      // Evolution needs the whole Baileys key to quote; Meta uses just the id.
      evolutionQuoted = {
        id: parent.message_id,
        remoteJid: parent.remote_jid ?? undefined,
        fromMe: parent.from_me ?? undefined,
      };
    }
  }

  // Template row (for header + button components). isMessageTemplate
  // guards against a malformed local row crashing the send-builder.
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();
    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  let waMessageId = '';
  let workingPhone = sanitizedPhone;
  // For Evolution rows: the recipient JID, persisted so reactions/replies
  // can rebuild the Baileys key later. NULL for Meta.
  let outboundRemoteJid: string | null = null;

  if (provider === 'evolution') {
    // Evolution/Baileys has no HSM templates and unreliable native
    // buttons/lists — both are rejected up front until they degrade to
    // plain text in a later pass. Text + media are the reply MVP.
    if (messageType === 'template' || messageType === 'interactive') {
      throw new SendMessageError(
        'not_supported',
        'Templates and interactive messages are not supported on the Evolution transport yet.',
        400
      );
    }
    if (!channel.base_url || !channel.instance_name || !channel.api_key) {
      throw new SendMessageError(
        'whatsapp_not_configured',
        'Evolution connection is incomplete — reconnect WhatsApp in Settings.',
        400
      );
    }
    const transport = getTransport({
      provider: 'evolution',
      baseUrl: channel.base_url,
      instance: channel.instance_name,
      apikey: decrypt(channel.api_key),
    });
    try {
      const res = isMediaKind
        ? await transport.sendMedia({
            to: sanitizedPhone,
            kind: messageType as MediaKind,
            media: mediaUrl!,
            caption: contentText || undefined,
            filename: filename || undefined,
            quoted: evolutionQuoted,
          })
        : await transport.sendText({
            to: sanitizedPhone,
            text: contentText!,
            quoted: evolutionQuoted,
          });
      waMessageId = res.providerMessageId;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Evolution error';
      console.error('[send-message] Evolution send failed:', message);
      throw new SendMessageError(
        'evolution_error',
        `Evolution API error: ${message}`,
        502
      );
    }
    outboundRemoteJid = `${toEvolutionNumber(sanitizedPhone)}@s.whatsapp.net`;
  } else {
    const attempt = async (phone: string): Promise<string> => {
      if (messageType === 'template') {
        const result = await sendTemplateMessage({
          phoneNumberId: channel.phone_number_id,
          accessToken,
          to: phone,
          templateName: templateName!,
          language: templateLanguage || 'en_US',
          template: templateRow ?? undefined,
          messageParams: templateMessageParams ?? undefined,
          params: templateParams || [],
          contextMessageId,
        });
        return result.messageId;
      }
      if (isMediaKind) {
        const result = await sendMediaMessage({
          phoneNumberId: channel.phone_number_id,
          accessToken,
          to: phone,
          kind: messageType as MediaKind,
          link: mediaUrl!,
          caption: contentText || undefined,
          filename: filename || undefined,
          contextMessageId,
        });
        return result.messageId;
      }
      if (messageType === 'interactive') {
        const p = interactivePayload!;
        if (p.kind === 'buttons') {
          const result = await sendInteractiveButtons({
            phoneNumberId: channel.phone_number_id,
            accessToken,
            to: phone,
            bodyText: p.body,
            headerText: p.header || undefined,
            footerText: p.footer || undefined,
            buttons: p.buttons,
            contextMessageId,
          });
          return result.messageId;
        }
        const result = await sendInteractiveList({
          phoneNumberId: channel.phone_number_id,
          accessToken,
          to: phone,
          bodyText: p.body,
          buttonLabel: p.button_label,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          sections: p.sections,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await sendTextMessage({
        phoneNumberId: channel.phone_number_id,
        accessToken,
        to: phone,
        text: contentText!,
        contextMessageId,
      });
      return result.messageId;
    };

    // Send via Meta — retry across phone-number variants if Meta rejects
    // with "recipient not in allowed list"; persist a working variant
    // back to the contact so the next send goes straight through.
    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) {
            throw err;
          }
          lastError = err;
          console.warn(
            `[send-message] variant "${variant}" rejected by Meta, trying next…`
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[send-message] Meta send failed for all variants:', message);
      throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
    }

    if (workingPhone !== sanitizedPhone) {
      console.log(
        `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`
      );
      await db
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact.id);
    }
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const interactiveBody =
    messageType === 'interactive' ? interactivePayload!.body : null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: interactiveBody ?? contentText ?? null,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      interactive_payload:
        messageType === 'interactive' ? interactivePayload : null,
      message_id: waMessageId,
      // Baileys key parts — only meaningful for Evolution (NULL for Meta).
      remote_jid: outboundRemoteJid,
      from_me: provider === 'evolution' ? true : null,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  const lastMessageText =
    messageType === 'interactive'
      ? interactivePayloadPreviewText(interactivePayload!)
      : contentText || `[${messageType}]`;

  await db
    .from('conversations')
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active');
    if (pauseErr) {
      console.error('[flows] pause-on-agent-send failed:', pauseErr.message);
    }
  } catch (err) {
    console.error(
      '[flows] pause-on-agent-send threw:',
      err instanceof Error ? err.message : err
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
