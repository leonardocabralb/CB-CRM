// ============================================================
// /api/v1/notes — internal conversation notes (migration 918).
//
// GET  (scope: notes:read)  — keyset-paginated list. Filters:
//        `?conversation_id=`, `?contact_id=`.
// POST (scope: notes:write) — create a note on a conversation.
//
// The write mirrors the dashboard route (`/api/cb/notes`): the
// conversation is resolved server-side (pass `conversation_id`, or
// `contact_id` and the account's single conversation for that
// contact is used — UNIQUE since migration 036), `autor_nome` is
// stamped, and the note is pinned to the resolved conversation, not
// to whatever the body claimed. @-mentions stay dashboard-only:
// they notify people, and validating "who may ping whom" is a
// person-to-person concern, not an integration one.
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
import { ehUuid } from '@/lib/tasks/validar';

/** Same ceiling as the dashboard route. */
const MAX_TEXTO = 4000;

interface ApiNote {
  id: string;
  conversation_id: string;
  contact_id: string | null;
  author_user_id: string | null;
  autor_nome: string | null;
  texto: string;
  created_at: string;
}

function serializeNote(row: Record<string, unknown>): ApiNote {
  return {
    id: row.id as string,
    conversation_id: row.conversation_id as string,
    contact_id: (row.contact_id as string | null) ?? null,
    author_user_id: (row.author_user_id as string | null) ?? null,
    autor_nome: (row.autor_nome as string | null) ?? null,
    texto: row.texto as string,
    created_at: row.created_at as string,
  };
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notes:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const conversationId = url.searchParams.get('conversation_id');
    const contactId = url.searchParams.get('contact_id');

    if (conversationId && !ehUuid(conversationId)) {
      throw badRequest("'conversation_id' must be a UUID");
    }
    if (contactId && !ehUuid(contactId)) {
      throw badRequest("'contact_id' must be a UUID");
    }

    let query = ctx.supabase
      .from('cb_conversation_notes')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (conversationId) query = query.eq('conversation_id', conversationId);
    if (contactId) query = query.eq('contact_id', contactId);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/notes] list error:', error);
      return fail('internal', 'Failed to list notes', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeNote(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'notes:write');

    const body = (await request.json().catch(() => null)) as {
      conversation_id?: unknown;
      contact_id?: unknown;
      texto?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    const porConversa = ehUuid(body.conversation_id);
    const porContato = ehUuid(body.contact_id);
    if (!porConversa && !porContato) {
      throw badRequest("'conversation_id' or 'contact_id' is required");
    }

    const texto = typeof body.texto === 'string' ? body.texto.trim() : '';
    if (!texto) throw badRequest("'texto' is required");
    if (texto.length > MAX_TEXTO) {
      throw badRequest(`'texto' exceeds ${MAX_TEXTO} characters`);
    }

    // Resolve the conversation, always account-scoped. By contact this
    // returns at most one row (UNIQUE on (account_id, contact_id)
    // since migration 036).
    const busca = ctx.supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('account_id', ctx.accountId);
    const { data: conversa, error: conversaErr } = porConversa
      ? await busca.eq('id', body.conversation_id as string).maybeSingle()
      : await busca.eq('contact_id', body.contact_id as string).maybeSingle();

    if (conversaErr) {
      // A DB error is NOT "no conversation" — answering 409 here would
      // tell the integrator the contact never talked to us.
      console.error('[api/v1/notes] conversation lookup error:', conversaErr);
      return fail('internal', 'Failed to resolve the conversation', 500);
    }
    if (!conversa) {
      if (porConversa) return fail('not_found', 'Conversation not found', 404);
      // A real case, not a caller error: a hand-created contact that
      // never exchanged a message has no conversation to note on.
      return fail(
        'contact_without_conversation',
        'This contact has no conversation yet',
        409
      );
    }

    const author = await resolveApiAuthor(ctx.supabase, ctx.accountId);

    const { data: nota, error } = await ctx.supabase
      .from('cb_conversation_notes')
      .insert({
        account_id: ctx.accountId,
        // The RESOLVED conversation, never the body's field — by
        // contact the body has no conversation_id at all.
        conversation_id: conversa.id,
        contact_id: conversa.contact_id ?? null,
        author_user_id: author.userId,
        autor_nome: author.nome,
        texto,
        mencionados: [],
      })
      .select('*')
      .single();

    if (error || !nota) {
      console.error('[api/v1/notes] insert error:', error);
      return fail('internal', 'Failed to create note', 500);
    }

    return ok(serializeNote(nota as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
