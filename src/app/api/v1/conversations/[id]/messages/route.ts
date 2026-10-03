// ============================================================
// GET /api/v1/conversations/{id}/messages — list a conversation's
// messages (scope: messages:read), newest first, keyset-paginated.
//
// The conversation is verified to belong to the key's account before
// any message is returned — a foreign or unknown id → 404.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { ehUuid } from '@/lib/tasks/validar';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { serializeMessage } from '@/lib/api/v1/conversations';
import type { Message } from '@/types';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'messages:read');
    const { id } = await params;
    // NOSSO: id malformado é 400 aqui, e não o 22P02 do PostgREST — é o que
    // deixa o erro da consulta abaixo significar só falha do banco.
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");
    const { limit, cursor } = parseListParams(request);

    // Gate on account ownership of the conversation first.
    const { data: conv, error: convErr } = await ctx.supabase
      .from('conversations')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      // Mesmo motivo do GET da conversa: grupo não existe para a v1, então o
      // histórico dele também não. Este gate é o que impede o vazamento.
      .is('group_id', null)
      .maybeSingle();
    // ⚠️ NOSSO: o upstream descarta o `error`, e um soluço do banco virava
    // "conversa não encontrada" (regra da v1: erro de banco nunca é 404).
    if (convErr) {
      console.error('[api/v1/messages] conversation lookup error:', convErr);
      return fail('internal', 'Failed to read conversation', 500);
    }
    if (!conv) return fail('not_found', 'Conversation not found', 404);

    let query = ctx.supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/messages] list error:', error);
      return fail('internal', 'Failed to list messages', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((m) => serializeMessage(m as unknown as Message)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
