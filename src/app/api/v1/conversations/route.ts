// ============================================================
// GET /api/v1/conversations — list conversations (scope: conversations:read)
//
// Keyset-paginated (newest first). Filters: `?status=` (open/pending/
// closed) and `?contact_id=`. Each conversation embeds its contact +
// tags via the shared CONVERSATION_SELECT.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { okList, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from '@/lib/inbox/conversations';
import { serializeConversation } from '@/lib/api/v1/conversations';
import type { Conversation } from '@/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'conversations:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const contactId = url.searchParams.get('contact_id');

    let query = ctx.supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .eq('account_id', ctx.accountId)
      // Grupos não existem para a v1 (migration 904). Sem isto quem integra
      // passaria a receber conversas com `contact` nulo — um formato que o
      // contrato publicado nunca prometeu e que quebraria integração alheia
      // sem aviso.
      .is('group_id', null);

    if (status) query = query.eq('status', status);
    if (contactId) query = query.eq('contact_id', contactId);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/conversations] list error:', error);
      return fail('internal', 'Failed to list conversations', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) =>
        serializeConversation(normalizeConversation(r as Conversation))
      ),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
