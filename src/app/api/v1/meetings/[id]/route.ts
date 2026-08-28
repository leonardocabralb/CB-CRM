// ============================================================
// GET /api/v1/meetings/{id} — read one meeting
// (scope: meetings:read).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeMeeting } from '@/lib/api/v1/meetings';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'meetings:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('cb_meetings')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !data) return fail('not_found', 'Meeting not found', 404);
    return ok(serializeMeeting(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
