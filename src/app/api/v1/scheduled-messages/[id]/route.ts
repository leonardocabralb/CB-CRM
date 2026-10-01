// ============================================================
// GET /api/v1/scheduled-messages/{id} — read one scheduled message
// (scope: scheduled:read).
//
// Read-only on purpose: cancelling and "send now" carry guards
// tied to the dispatch worker (`podeDispararAgora`, media cleanup)
// and stay dashboard-only.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { serializeScheduled } from '@/lib/api/v1/scheduled';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'scheduled:read');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const { data, error } = await ctx.supabase
      .from('cb_scheduled_messages')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // ⚠️ Erro de banco NÃO é "não encontrado" (regra da v1): quem consulta a
    // agendada para saber se ela saiu concluiria que ela nunca existiu.
    if (error) {
      console.error('[api/v1/scheduled-messages/:id] read error:', error);
      return fail('internal', 'Failed to read scheduled message', 500);
    }
    if (!data) {
      return fail('not_found', 'Scheduled message not found', 404);
    }

    return ok(serializeScheduled(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
