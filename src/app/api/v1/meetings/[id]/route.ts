// ============================================================
// GET /api/v1/meetings/{id} — read one meeting
// (scope: meetings:read).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeMeeting } from '@/lib/api/v1/meetings';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'meetings:read');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const { data, error } = await ctx.supabase
      .from('cb_meetings')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // ⚠️ Erro de banco NÃO é "não encontrado" (regra da v1).
    if (error) {
      console.error('[api/v1/meetings/:id] read error:', error);
      return fail('internal', 'Failed to read meeting', 500);
    }
    if (!data) return fail('not_found', 'Meeting not found', 404);
    return ok(serializeMeeting(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
