// ============================================================
// GET /api/v1/scheduled-messages/{id} — read one scheduled message
// (scope: scheduled:read).
//
// Read-only on purpose: cancelling and "send now" carry guards
// tied to the dispatch worker (`podeDispararAgora`, media cleanup)
// and stay dashboard-only.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeScheduled } from '@/lib/api/v1/scheduled';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'scheduled:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('cb_scheduled_messages')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error || !data) {
      return fail('not_found', 'Scheduled message not found', 404);
    }

    return ok(serializeScheduled(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
