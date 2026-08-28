// ============================================================
// GET /api/v1/pipelines — list pipelines with their stages
// (scope: deals:read).
//
// Exists for the same reason as /api/v1/channels: every deal
// endpoint takes pipeline/stage UUIDs, and nothing else tells an
// integrator which ones are valid. Not paginated — an account has
// a handful of pipelines, like channels.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializePipeline } from '@/lib/api/v1/deals';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');

    const { data, error } = await ctx.supabase
      .from('pipelines')
      .select('id, name, created_at, pipeline_stages(id, name, position, color)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[api/v1/pipelines] list error:', error);
      return fail('internal', 'Failed to list pipelines', 500);
    }

    return ok(
      (data ?? []).map((r) => serializePipeline(r as Record<string, unknown>))
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
