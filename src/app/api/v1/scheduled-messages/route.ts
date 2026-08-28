// ============================================================
// /api/v1/scheduled-messages — list and schedule messages
// (migration 925).
//
// GET  (scope: scheduled:read)  — keyset-paginated list. Filters:
//        `?conversation_id=`, `?status=` (pending|sending|sent|failed).
// POST (scope: scheduled:write) — schedule a TEXT message.
//
// The write mirrors `/api/cb/scheduled` guard by guard — those
// guards are the feature, not decoration:
//
//  - the channel is RESOLVED here and frozen on the row, failing
//    closed when the account has no `cb_channels` connection: a
//    scheduled message must promise which number it leaves through;
//  - group conversations resolve the channel from `cb_groups`
//    (`conversations.channel_id` is always NULL for groups);
//  - the time is checked against the SERVER clock, in the future,
//    at most 365 days ahead (a typo'd year would park a pending row
//    forever and, via the RESTRICT FK, block deleting the channel);
//  - `autor_nome` is stamped server-side.
//
// Attachments and quoted replies stay dashboard-only: their
// ownership checks are tied to the upload flow (932). Nothing here
// dispatches anything — an external cron drives the actual send.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import {
  ok,
  okList,
  fail,
  badRequest,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveApiAuthor } from '@/lib/api/v1/authorship';
import { serializeScheduled } from '@/lib/api/v1/scheduled';
import { instanteValido } from '@/lib/agenda/validar';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { ehUuid } from '@/lib/tasks/validar';

/** Same ceilings as the dashboard route and the 925 CHECK. */
const MAX_TEXTO = 4000;
const MAX_DIAS_A_FRENTE = 365;

const STATUSES = ['pending', 'sending', 'sent', 'failed'];

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'scheduled:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    const status = url.searchParams.get('status');

    if (status && !STATUSES.includes(status)) {
      throw badRequest(`'status' must be one of: ${STATUSES.join(', ')}`);
    }
    if (conversationId && !ehUuid(conversationId)) {
      throw badRequest("'conversation_id' must be a UUID");
    }

    let query = ctx.supabase
      .from('cb_scheduled_messages')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (conversationId) query = query.eq('conversation_id', conversationId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/scheduled-messages] list error:', error);
      return fail('internal', 'Failed to list scheduled messages', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeScheduled(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'scheduled:write');

    const body = (await request.json().catch(() => null)) as {
      conversation_id?: unknown;
      body?: unknown;
      scheduled_for?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    if (!ehUuid(body.conversation_id)) {
      throw badRequest("'conversation_id' is required");
    }
    const conversationId = body.conversation_id;

    const texto = typeof body.body === 'string' ? body.body.trim() : '';
    if (!texto) throw badRequest("'body' is required (text only via the API)");
    if (texto.length > MAX_TEXTO) {
      throw badRequest(`'body' exceeds ${MAX_TEXTO} characters`);
    }

    // ⚠️ The offset must be WRITTEN in the string (Z or ±HH:MM). The
    // dashboard route can accept it loose because the browser always
    // sends an offset; an API integrator sending "2026-09-01T14:00:00"
    // would get the SERVER's interpretation of that wall time and the
    // message would fire at the wrong hour, with no error anywhere.
    const quando =
      typeof body.scheduled_for === 'string' ? body.scheduled_for : '';
    if (!instanteValido(quando)) {
      throw badRequest(
        "'scheduled_for' must be an ISO-8601 datetime WITH a timezone offset (Z or ±HH:MM)"
      );
    }
    const data = new Date(quando);
    // Server clock — the caller's clock can't turn "schedule" into
    // "send now".
    if (data.getTime() <= Date.now()) {
      throw badRequest("'scheduled_for' is in the past");
    }
    if (data.getTime() > Date.now() + MAX_DIAS_A_FRENTE * 86_400_000) {
      throw badRequest(
        `'scheduled_for' is more than ${MAX_DIAS_A_FRENTE} days ahead`
      );
    }

    // ⚠️ The `group:cb_groups(channel_id)` join is load-bearing: group
    // conversations always have `conversations.channel_id` NULL, and
    // resolving via the account default would stamp the wrong number.
    const { data: conversa, error: conversaErr } = await ctx.supabase
      .from('conversations')
      .select('id, channel_id, group_id, group:cb_groups(channel_id)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (conversaErr) {
      console.error('[api/v1/scheduled-messages] conversation lookup error:', conversaErr);
      return fail('internal', 'Failed to verify the conversation', 500);
    }
    if (!conversa) return fail('not_found', 'Conversation not found', 404);

    const linha = conversa as {
      channel_id?: string | null;
      group_id?: string | null;
      group?: { channel_id?: string | null } | null;
    };
    const ehGrupo = !!linha.group_id;
    const canalDaConversa = ehGrupo
      ? (linha.group?.channel_id ?? null)
      : (linha.channel_id ?? null);

    if (ehGrupo && !canalDaConversa) {
      return fail(
        'group_channel_unknown',
        'This group has no known channel. Re-sync groups in Settings → Connections before scheduling.',
        409
      );
    }

    // Fail closed: without a `cb_channels` row there is no number to
    // promise the message will leave through.
    const canal = await resolveChannelForConversation(
      ctx.supabase,
      ctx.accountId,
      { channel_id: canalDaConversa }
    );
    if (!canal?.channelId) {
      return fail(
        'no_channel',
        'This account has no registered WhatsApp connection to schedule from.',
        409
      );
    }

    const author = await resolveApiAuthor(ctx.supabase, ctx.accountId);

    const { data: criada, error } = await ctx.supabase
      .from('cb_scheduled_messages')
      .insert({
        account_id: ctx.accountId,
        conversation_id: conversationId,
        channel_id: canal.channelId,
        body: texto,
        scheduled_for: data.toISOString(),
        created_by: author.userId,
        autor_nome: author.nome,
      })
      .select('*')
      .single();

    if (error || !criada) {
      console.error('[api/v1/scheduled-messages] insert error:', error);
      return fail('internal', 'Failed to schedule the message', 500);
    }

    return ok(serializeScheduled(criada as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
