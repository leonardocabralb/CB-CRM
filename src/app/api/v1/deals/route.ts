// ============================================================
// /api/v1/deals — list and create deals (migration 908).
//
// GET  (scope: deals:read)  — keyset-paginated list. Filters:
//        `?pipeline_id=`, `?stage_id=`, `?contact_id=`, `?status=`
//        (open|won|lost).
// POST (scope: deals:write) — create a deal via `createDeal`, the
//        single server-side birthplace of deals: it validates the
//        pipeline belongs to the account, the stage belongs to the
//        pipeline (falling back to the lowest-position stage), and
//        stamps the account currency. API-created deals get
//        `source: 'manual'` and no channel (the channel column
//        means "which number the customer arrived through", which
//        an API call doesn't know).
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
import { resolveAuditUserId } from '@/lib/api/v1/contacts';
import { serializeDeal } from '@/lib/api/v1/deals';
import { createDeal } from '@/lib/deals/create-deal';
import { ehUuid } from '@/lib/tasks/validar';

const STATUSES = ['open', 'won', 'lost'];

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:read');
    const { limit, cursor } = parseListParams(request);
    const url = new URL(request.url);
    const pipelineId = url.searchParams.get('pipeline_id');
    const stageId = url.searchParams.get('stage_id');
    const contactId = url.searchParams.get('contact_id');
    const status = url.searchParams.get('status');

    for (const [name, value] of [
      ['pipeline_id', pipelineId],
      ['stage_id', stageId],
      ['contact_id', contactId],
    ] as const) {
      if (value && !ehUuid(value)) throw badRequest(`'${name}' must be a UUID`);
    }
    if (status && !STATUSES.includes(status)) {
      throw badRequest(`'status' must be one of: ${STATUSES.join(', ')}`);
    }

    let query = ctx.supabase
      .from('deals')
      .select('*')
      .eq('account_id', ctx.accountId);

    if (pipelineId) query = query.eq('pipeline_id', pipelineId);
    if (stageId) query = query.eq('stage_id', stageId);
    if (contactId) query = query.eq('contact_id', contactId);
    if (status) query = query.eq('status', status);

    query = query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    const kf = keysetFilter(cursor);
    if (kf) query = query.or(kf);

    const { data, error } = await query;
    if (error) {
      console.error('[api/v1/deals] list error:', error);
      return fail('internal', 'Failed to list deals', 500);
    }

    const { items, nextCursor } = buildPage(
      (data ?? []) as Array<{ created_at: string; id: string }>,
      limit
    );
    return okList(
      items.map((r) => serializeDeal(r as Record<string, unknown>)),
      nextCursor
    );
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'deals:write');

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
      pipeline_id?: unknown;
      stage_id?: unknown;
      title?: unknown;
      value?: unknown;
    } | null;
    if (!body) throw badRequest('Invalid JSON body');

    if (!ehUuid(body.contact_id)) throw badRequest("'contact_id' is required");
    if (!ehUuid(body.pipeline_id)) throw badRequest("'pipeline_id' is required");
    if (
      body.stage_id !== undefined &&
      body.stage_id !== null &&
      !ehUuid(body.stage_id)
    ) {
      throw badRequest("'stage_id' must be a UUID");
    }

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) throw badRequest("'title' is required");

    let value: number | undefined;
    if (body.value !== undefined && body.value !== null) {
      if (typeof body.value !== 'number' || !Number.isFinite(body.value) || body.value < 0) {
        throw badRequest("'value' must be a non-negative number");
      }
      value = body.value;
    }

    // `createDeal` validates pipeline/stage tenancy but takes the
    // contact on trust — the router already knows its contact. An API
    // caller doesn't, so check it here.
    const { data: contato } = await ctx.supabase
      .from('contacts')
      .select('id')
      .eq('id', body.contact_id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!contato) return fail('not_found', 'Contact not found', 404);

    const ownerUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);

    const result = await createDeal({
      db: ctx.supabase,
      accountId: ctx.accountId,
      ownerUserId,
      contactId: body.contact_id,
      pipelineId: body.pipeline_id,
      stageId: ehUuid(body.stage_id) ? body.stage_id : null,
      title,
      value,
      source: 'manual',
    });

    if (!result.ok) {
      if (result.code === 'pipeline_not_found') {
        return fail('not_found', result.message, 404);
      }
      if (result.code === 'stage_not_found' || result.code === 'no_stage') {
        return fail(result.code, result.message, 400);
      }
      console.error('[api/v1/deals] create error:', result.message);
      return fail('internal', 'Failed to create deal', 500);
    }

    // `dealId` is null only on the router's unique-index collision,
    // which requires `source: 'channel'` — unreachable here. Guard
    // anyway rather than serialize a row we don't have.
    if (!result.dealId) {
      return fail('internal', 'Deal was created but could not be read back', 500);
    }

    const { data: deal, error } = await ctx.supabase
      .from('deals')
      .select('*')
      .eq('id', result.dealId)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error || !deal) {
      console.error('[api/v1/deals] readback error:', error);
      return fail('internal', 'Deal was created but could not be read back', 500);
    }

    return ok(serializeDeal(deal as Record<string, unknown>), 201);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
