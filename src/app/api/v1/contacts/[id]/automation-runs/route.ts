// ============================================================
// GET /api/v1/contacts/{id}/automation-runs — o histórico de automações de
// um cliente (scope: automations:read). NOSSO (1120).
//
// Keyset-paginated, mais recente primeiro. Cada item é uma execução
// (`automation_logs`): qual automação, o que disparou, como terminou
// (`outcome`), se foi interrompida e por quê, e os passos gravados. O
// formato e as ressalvas estão em `src/lib/api/v1/automation-runs.ts`.
//
// Id de ficha UNIDA a outra (1092) lê a ficha que ficou, como as outras
// rotas `/contacts/{id}`. Aceita a chave recortada por funil: cliente fora
// do recorte é o mesmo 404 de quem não existe.
// ⚠️ Só leitura de `automation_logs`: a fila de esperas
// (`automation_pending_executions`, com o `context` da execução) não entra.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, fail, okList, toApiErrorResponse } from '@/lib/api/v1/respond';
import { buildPage, keysetFilter, parseListParams } from '@/lib/api/v1/pagination';
import { idAtualDaFicha } from '@/lib/api/v1/contacts';
import { contatoNoRecorte } from '@/lib/api/v1/recorte-por-funil';
import { serializeAutomationRun } from '@/lib/api/v1/automation-runs';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'automations:read', { aceitaRecorte: true });
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");
    const { limit, cursor } = parseListParams(request);

    const contactId = await idAtualDaFicha(ctx.supabase, ctx.accountId, id);
    if (!contactId) return fail('not_found', 'Contact not found', 404);
    if (!(await contatoNoRecorte(ctx, contactId))) {
      return fail('not_found', 'Contact not found', 404);
    }

    let query = ctx.supabase
      .from('automation_logs')
      .select(
        'id, automation_id, trigger_event, desfecho, error_message, steps_executed, created_at, finalizado_em, interrompida_em, interrompida_por, automations(name)'
      )
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/automation-runs] list error:', error);
      return fail('internal', 'Failed to list automation runs', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as unknown as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeAutomationRun(r as unknown as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
