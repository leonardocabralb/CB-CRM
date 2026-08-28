// ============================================================
// /api/v1/meetings — list and create calendar meetings
// (migration 945).
//
// GET  (scope: meetings:read)  — keyset-paginated list. Filters:
//        `?owner_user_id=`, `?contact_id=`, `?status=`
//        (agendada|realizada|cancelada|falta), and a time window on
//        `starts_at` via `?from=` / `?to=` (ISO-8601 instants).
// POST (scope: meetings:write) — create a meeting.
//
// The write mirrors the dashboard route (`/api/cb/agenda`): shape
// validation lives in `validarReuniao` (same ceilings as the 945
// CHECKs, but with readable messages), the owner is validated as a
// member of THIS account (the route runs service-role, and the FK
// points at the global `auth.users`), names are stamped
// server-side, and the EXCLUDE-constraint violation (two
// overlapping meetings for the same owner) maps to a 409 instead
// of leaking a raw Postgres error.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import {
  ok,
  okList,
  fail,
  badRequest,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  parseListParams,
  keysetFilter,
  buildPage,
} from '@/lib/api/v1/pagination';
import { resolveApiAuthor } from '@/lib/api/v1/authorship';
import { serializeMeeting } from '@/lib/api/v1/meetings';
import { validarReuniao, instanteValido, STATUS, TIPOS } from '@/lib/agenda/validar';
import { ehUuid } from '@/lib/tasks/validar';

/** Postgres code for the EXCLUDE ("no overlap") constraint. */
const SOBREPOSICAO = '23P01';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'meetings:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const ownerId = url.searchParams.get('owner_user_id');
    const contactId = url.searchParams.get('contact_id');
    const status = url.searchParams.get('status');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (ownerId && !ehUuid(ownerId)) {
      throw badRequest("'owner_user_id' must be a UUID");
    }
    if (contactId && !ehUuid(contactId)) {
      throw badRequest("'contact_id' must be a UUID");
    }
    if (status && !STATUS.includes(status as (typeof STATUS)[number])) {
      throw badRequest(`'status' must be one of: ${STATUS.join(', ')}`);
    }
    for (const [name, value] of [
      ['from', from],
      ['to', to],
    ] as const) {
      if (value && Number.isNaN(Date.parse(value))) {
        throw badRequest(`'${name}' must be an ISO-8601 datetime`);
      }
    }

    let query = ctx.supabase
      .from('cb_meetings')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (ownerId) query = query.eq('owner_user_id', ownerId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (status) query = query.eq('status', status);
    if (from) query = query.gte('starts_at', from);
    if (to) query = query.lt('starts_at', to);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/meetings] list error:', error);
      return fail('internal', 'Failed to list meetings', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeMeeting(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'meetings:write');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) throw badRequest('Invalid JSON body');

    const erro = validarReuniao(body);
    if (erro) throw badRequest(erro);

    // `validarReuniao` already checked shape; these two re-checks are
    // for the type-narrowing below.
    if (!instanteValido(body.starts_at) || !instanteValido(body.ends_at)) {
      throw badRequest('Invalid meeting times');
    }

    const author = await resolveApiAuthor(ctx.supabase, ctx.accountId);

    // Owner defaults to the audit user; an explicit owner must be a
    // member of this account.
    const ownerId = ehUuid(body.owner_user_id)
      ? (body.owner_user_id as string)
      : author.userId;

    const { data: dono } = await ctx.supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .eq('user_id', ownerId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!dono) {
      throw badRequest("'owner_user_id' is not a member of this account");
    }

    let contactId: string | null = null;
    let contatoNome: string | null = null;
    if (body.contact_id !== undefined && body.contact_id !== null) {
      if (!ehUuid(body.contact_id)) {
        throw badRequest("'contact_id' must be a UUID");
      }
      const { data: contato } = await ctx.supabase
        .from('contacts')
        .select('id, name, phone')
        .eq('id', body.contact_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (!contato) return fail('not_found', 'Contact not found', 404);
      contactId = contato.id as string;
      contatoNome = (contato.name as string | null) ?? (contato.phone as string);
    }

    const { data: criada, error } = await ctx.supabase
      .from('cb_meetings')
      .insert({
        account_id: ctx.accountId,
        owner_user_id: ownerId,
        owner_nome:
          (dono.full_name as string | null)?.trim() ||
          (dono.email as string | null) ||
          author.nome,
        contact_id: contactId,
        contato_nome: contatoNome,
        titulo: (body.titulo as string).trim(),
        descricao:
          typeof body.descricao === 'string' && body.descricao.trim()
            ? body.descricao.trim()
            : null,
        local:
          typeof body.local === 'string' && body.local.trim()
            ? body.local.trim()
            : null,
        tipo: TIPOS.includes(body.tipo as (typeof TIPOS)[number])
          ? body.tipo
          : 'outra',
        starts_at: body.starts_at as string,
        ends_at: body.ends_at as string,
        status: STATUS.includes(body.status as (typeof STATUS)[number])
          ? body.status
          : 'agendada',
        created_by: author.userId,
        autor_nome: author.nome,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === SOBREPOSICAO) {
        return fail(
          'overlap',
          'The owner already has a meeting in that time slot',
          409
        );
      }
      console.error('[api/v1/meetings] insert error:', error);
      return fail('internal', 'Failed to create meeting', 500);
    }

    return ok(serializeMeeting(criada as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
