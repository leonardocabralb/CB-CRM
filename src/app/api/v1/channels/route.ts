// ============================================================
// GET /api/v1/channels — list the account's WhatsApp numbers.
//
// Exists because every other channel-aware endpoint takes a `channel_id`
// (POST /api/v1/messages, and the broadcast/template routes) but nothing
// told an integrator which UUIDs are valid. Without this, "send from the
// Comercial number" is unbuildable from outside.
//
// Auth: API key with the `channels:read` scope.
//
// Response (200):
//   { "data": [ { "id", "label", "kind", "display_phone", "is_default",
//                 "status", "connected_at" } ] }
//
// Secrets (access_token, api_key, verify_token) never leave the server —
// `listChannels` projects CB_CHANNEL_SAFE_COLUMNS, and this serializer
// narrows it further to what an integrator actually needs.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, toApiErrorResponse } from '@/lib/api/v1/respond';
import { listChannels } from '@/lib/cb-channels/repo';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'channels:read');
    const channels = await listChannels(ctx.supabase, ctx.accountId);

    return ok(
      channels.map((c) => ({
        id: c.id,
        label: c.label,
        // 'meta' = número oficial (Cloud API); 'evolution' = não-oficial (QR).
        // Só canais 'meta' aceitam template e mensagem interativa.
        kind: c.kind,
        display_phone: c.display_phone,
        is_default: c.is_default,
        status: c.status,
        connected_at: c.connected_at,
      }))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
