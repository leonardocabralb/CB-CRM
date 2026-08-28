// ============================================================
// /api/v1/tasks — list and create tasks (migration 944).
//
// GET  (scope: tasks:read)  — keyset-paginated list. Filters:
//        `?contact_id=`, `?responsavel_user_id=`, `?status=`
//        (aberta | concluida).
// POST (scope: tasks:write) — create a task for a team member.
//
// Writes mirror the dashboard route (`/api/cb/tasks`), which exists
// because the browser can't write `cb_tasks` at all: names are
// stamped server-side, the assignee is validated against the
// account, and the notification insert needs service-role. The API
// path keeps every one of those guarantees; the only differences
// are the author (the v1 audit user — see `resolveApiAuthor`) and
// that replies/sub-tasks (`tarefa_pai_id`) stay dashboard-only:
// "the reply goes back to whoever asked" is a person-to-person
// rule, and an API key is not a person.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, okList, fail, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveApiAuthor } from '@/lib/api/v1/authorship';
import { serializeTask } from '@/lib/api/v1/tasks';
import {
  ehDataValida,
  ehUuid,
  normalizarDescricao,
  normalizarHora,
  normalizarTitulo,
} from '@/lib/tasks/validar';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const contactId = url.searchParams.get('contact_id');
    const responsavelId = url.searchParams.get('responsavel_user_id');
    const status = url.searchParams.get('status');

    if (status && status !== 'aberta' && status !== 'concluida') {
      throw badRequest("'status' must be 'aberta' or 'concluida'");
    }
    if (contactId && !ehUuid(contactId)) {
      throw badRequest("'contact_id' must be a UUID");
    }
    if (responsavelId && !ehUuid(responsavelId)) {
      throw badRequest("'responsavel_user_id' must be a UUID");
    }

    let query = ctx.supabase
      .from('cb_tasks')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (contactId) query = query.eq('contact_id', contactId);
    if (responsavelId) query = query.eq('responsavel_user_id', responsavelId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/tasks] list error:', error);
      return fail('internal', 'Failed to list tasks', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeTask(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'tasks:write');

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
      responsavel_user_id?: unknown;
      titulo?: unknown;
      descricao?: unknown;
      vence_em?: unknown;
      vence_as?: unknown;
      importante?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    const titulo = normalizarTitulo(body.titulo);
    if (!titulo) throw badRequest("'titulo' is required (1–200 chars)");

    const descricao = normalizarDescricao(body.descricao);
    if (descricao === undefined) throw badRequest("'descricao' is too long");

    if (!ehDataValida(body.vence_em)) {
      throw badRequest("'vence_em' must be a real YYYY-MM-DD date");
    }

    // `undefined` = malformed, `null` = deliberately no time — see
    // `normalizarHora`. Collapsing the two would silently turn a typo
    // into an all-day task.
    const vence_as = normalizarHora(body.vence_as);
    if (vence_as === undefined) throw badRequest("'vence_as' must be HH:MM");

    if (!ehUuid(body.contact_id)) throw badRequest("'contact_id' is required");
    if (!ehUuid(body.responsavel_user_id)) {
      throw badRequest("'responsavel_user_id' is required");
    }
    const contactId = body.contact_id;
    const responsavelId = body.responsavel_user_id;

    // Service-role client: every ownership check is an explicit
    // account filter, same discipline as the rest of v1. A DB error is
    // NOT "not found" — a 404 would tell the integrator the contact
    // vanished and invite a duplicate re-create.
    const { data: contato, error: contatoErr } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', contactId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (contatoErr) {
      console.error('[api/v1/tasks] contact lookup error:', contatoErr);
      return fail('internal', 'Failed to verify the contact', 500);
    }
    if (!contato) return fail('not_found', 'Contact not found', 404);

    // Membership check doubles as the frozen-name lookup, like the
    // dashboard route.
    const { data: perfil, error: perfilErr } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .eq('account_id', ctx.accountId)
      .eq('user_id', responsavelId)
      .maybeSingle();
    if (perfilErr) {
      console.error('[api/v1/tasks] member lookup error:', perfilErr);
      return fail('internal', 'Could not load members', 500);
    }
    if (!perfil) {
      throw badRequest("'responsavel_user_id' is not a member of this account");
    }
    const responsavelNome =
      (perfil.full_name as string | null)?.trim() ||
      (perfil.email as string | null) ||
      null;

    const author = await resolveApiAuthor(ctx.supabase, ctx.accountId);

    const { data: tarefa, error } = await ctx.supabase
      .from('cb_tasks')
      .insert({
        account_id: ctx.accountId,
        contact_id: contactId,
        criador_user_id: author.userId,
        responsavel_user_id: responsavelId,
        criador_nome: author.nome,
        responsavel_nome: responsavelNome,
        titulo,
        descricao,
        vence_em: body.vence_em,
        vence_as,
        importante: body.importante === true,
        tipo: 'tarefa',
      })
      .select('*')
      .single();

    if (error || !tarefa) {
      console.error('[api/v1/tasks] insert error:', error);
      return fail('internal', 'Failed to create task', 500);
    }

    // Notify the assignee — after the task, and never at its expense
    // (same policy as the dashboard route: the task is the act, the
    // bell is only news about it). Self-assigned tasks don't notify.
    if (responsavelId !== author.userId) {
      const { error: erroSino } = await ctx.supabase
        .from('notifications')
        .insert({
          account_id: ctx.accountId,
          user_id: responsavelId,
          type: 'task_assigned',
          contact_id: contactId,
          task_id: tarefa.id,
          actor_user_id: author.userId,
          title: `${author.nome} encaminhou uma tarefa para você`,
          body: titulo,
        });
      if (erroSino) {
        console.error('[api/v1/tasks] notify error:', erroSino.message);
      }
    }

    return ok(serializeTask(tarefa as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
