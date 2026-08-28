// ============================================================
// GET /api/v1/tasks/{id} — read one task (scope: tasks:read).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeTask } from '@/lib/api/v1/tasks';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { id } = await params;

    const { data, error } = await ctx.supabase
      .from('cb_tasks')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // A malformed id makes PostgREST error (22P02); to the caller
    // that's indistinguishable from "no such task" — same behavior
    // as `getContactById`.
    if (error || !data) return fail('not_found', 'Task not found', 404);

    return ok(serializeTask(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
