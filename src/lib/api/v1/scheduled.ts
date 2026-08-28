// ============================================================
// Shared serialization for the public API (v1) scheduled-message
// endpoints (migration 925/926/932).
// ============================================================

export interface ApiScheduledMessage {
  id: string;
  conversation_id: string;
  /** The number this message will leave through — fixed at scheduling. */
  channel_id: string;
  body: string;
  scheduled_for: string;
  status: 'pending' | 'sending' | 'sent' | 'failed';
  /** Human-readable failure reason, when `status` is `failed`. */
  error: string | null;
  /**
   * The send failed AFTER WhatsApp may have accepted the message.
   * Nothing may be re-sent from a row with this flag — the customer
   * could receive it twice.
   */
  entrega_incerta: boolean;
  media_kind: 'image' | 'video' | 'document' | 'audio' | null;
  media_filename: string | null;
  reply_to_message_id: string | null;
  citacao_perdida: boolean;
  /** `messages.id` of what actually went out, once sent. */
  message_id: string | null;
  created_by: string | null;
  autor_nome: string;
  created_at: string;
  sent_at: string | null;
}

export function serializeScheduled(
  row: Record<string, unknown>
): ApiScheduledMessage {
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    channel_id: row.channel_id as string,
    body: row.body as string,
    scheduled_for: row.scheduled_for as string,
    status: row.status as ApiScheduledMessage['status'],
    error: (row.error as string | null) ?? null,
    entrega_incerta: row.entrega_incerta === true,
    media_kind: (row.media_kind as ApiScheduledMessage['media_kind']) ?? null,
    media_filename: (row.media_filename as string | null) ?? null,
    reply_to_message_id: (row.reply_to_message_id as string | null) ?? null,
    citacao_perdida: row.citacao_perdida === true,
    message_id: (row.message_id as string | null) ?? null,
    created_by: (row.created_by as string | null) ?? null,
    autor_nome: row.autor_nome as string,
    created_at: row.created_at as string,
    sent_at: (row.sent_at as string | null) ?? null,
  };
}
