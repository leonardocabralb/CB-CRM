// ============================================================
// GET /api/v1/tasks/{id} — read one task (scope: tasks:read).
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { contatoNoRecorte } from '@/lib/api/v1/recorte-por-funil';
import { serializeTask } from '@/lib/api/v1/tasks';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read', { aceitaRecorte: true });
    const { id } = await params;
    // O id malformado é recusado AQUI, e não pelo erro do PostgREST (22P02):
    // é o que deixa o `error` abaixo significar só falha do banco.
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const { data, error } = await ctx.supabase
      .from('cb_tasks')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    // ⚠️ Erro de banco NÃO é "não encontrado" (regra da v1).
    if (error) {
      console.error('[api/v1/tasks/:id] read error:', error);
      return fail('internal', 'Failed to read task', 500);
    }
    if (!data) return fail('not_found', 'Task not found', 404);
    // NOSSO (1121): tarefa de cliente fora do recorte por funil (ou sem
    // cliente) = o mesmo 404.
    const contactId = (data as { contact_id?: string | null }).contact_id ?? null;
    if (!(await contatoNoRecorte(ctx, contactId))) {
      return fail('not_found', 'Task not found', 404);
    }

    return ok(serializeTask(data as Record<string, unknown>));
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
