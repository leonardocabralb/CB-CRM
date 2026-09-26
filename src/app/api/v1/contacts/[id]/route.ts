// ============================================================
// GET   /api/v1/contacts/{id} — read a contact  (scope: contacts:read)
// PATCH /api/v1/contacts/{id} — update a contact (scope: contacts:write)
//
// Both are account-scoped: a contact belonging to another account
// returns 404 (never 403 — don't reveal it exists elsewhere).
// PATCH updates only the fields present in the body; pass `tags` (an
// array of tag names or tag ids) to replace the contact's tags — or, with
// `tags_mode: "add"`, only to add them (nothing is removed; the same
// opt-in as `POST /contacts`, and an unknown value is a 400).
//
// ⚠️ `tags` é lido ANTES de gravar nome/e-mail/empresa (`lerTagsPedidas`,
// só leitura): um id que não é desta conta volta 400 `unknown_tag_ids` com
// o contato intocado, em vez de um 400 sobre um contato já alterado. E a
// FORMA dele é conferida antes de qualquer consulta: item que não é texto,
// ou é vazio, volta 400 — descartado em silêncio, ele virava "tirar todas
// as etiquetas" (ver `lerTagsDoCorpo`).
//
// ⚠️ O `{id}` é conferido como UUID logo depois da chave: cru, um id
// malformado chegava ao `.eq('id', …)`, o Postgres o recusava (22P02) e o
// integrador lia 500 "Failed to load contact" — erro NOSSO sobre entrada
// DELE, e 5xx é o que cliente HTTP retenta. Mesma régua de `[id]/tags`.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { badRequest, ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getContactById,
  lerTagsPedidas,
  setContactTags,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import {
  avisarRecusaDeEtiqueta,
  lerModoDasTags,
  lerTagsDoCorpo,
  TagReferenceError,
} from '@/lib/api/v1/tags-do-contato';
import { ehUuid } from '@/lib/tasks/validar';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:read');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");
    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contact) return fail('not_found', 'Contact not found', 404);
    return ok(contact);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

const ROTA_DO_PATCH = 'PATCH /api/v1/contacts/{id}';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Fora do `try`: o `catch` registra o 400 de etiqueta com o id da chave.
  let keyId: string | null = null;
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    keyId = ctx.keyId;
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    // Forma de `tags` e `tags_mode`: puro, antes de qualquer consulta ou
    // escrita. ⚠️ O `tags_mode` vale aqui também, e não só no POST: sem ele,
    // quem aprendesse o campo no POST e o mandasse no PATCH teria as outras
    // etiquetas APAGADAS com 200 — o campo desconhecido seria ignorado.
    const tags = lerTagsDoCorpo(body.tags);
    if (tags && !Array.isArray(tags)) {
      avisarRecusaDeEtiqueta(ROTA_DO_PATCH, 'bad_request', keyId);
      return fail('bad_request', tags.erro, 400);
    }
    const modo = lerModoDasTags(body.tags_mode);
    if (typeof modo !== 'string') {
      avisarRecusaDeEtiqueta(ROTA_DO_PATCH, 'bad_request', keyId);
      return fail('bad_request', modo.erro, 400);
    }

    // Verify the contact is in this account before mutating anything.
    const existing = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!existing) return fail('not_found', 'Contact not found', 404);

    // Build a partial update from the provided scalar fields. A field
    // is updated only when its key is PRESENT (so omitted fields are
    // untouched); `null` clears it, a string sets it, and any other
    // type is a 400 rather than a silently-ignored no-op.
    //
    // ⚠️ Texto é APARADO, e texto que fica VAZIO não mexe no campo (decisão
    // do operador, 26/09/2026). O Make monta o corpo como `"{{variável}}"`:
    // a resposta ainda não dada chegava como `""` e apagava o dado, e o nome
    // digitado com espaço no fim ("ALINI ") passava por cima do que o
    // Calendly tinha fixado sem ele. Limpar de propósito continua sendo `null`.
    const updates: Record<string, unknown> = {};
    for (const field of ['name', 'email', 'company'] as const) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null) {
        updates[field] = null;
      } else if (typeof value === 'string') {
        const aparado = value.trim();
        if (aparado !== '') updates[field] = aparado;
      } else {
        return fail('bad_request', `'${field}' must be a string or null`, 400);
      }
    }

    // Só leitura — a última conferência antes da primeira escrita.
    const tagsPedidas = tags
      ? await lerTagsPedidas(ctx.supabase, ctx.accountId, tags)
      : null;

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error } = await ctx.supabase
        .from('contacts')
        .update(updates)
        .eq('id', id)
        .eq('account_id', ctx.accountId);
      if (error) {
        console.error('[api/v1/contacts] update error:', error);
        return fail('internal', 'Failed to update contact', 500);
      }
    }

    if (tagsPedidas) {
      const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
      await setContactTags(
        ctx.supabase,
        ctx.accountId,
        auditUserId,
        id,
        tagsPedidas,
        { somenteAcrescentar: modo === 'add' }
      );
    }

    const contact = await getContactById(ctx.supabase, ctx.accountId, id);
    return ok(contact);
  } catch (err) {
    if (err instanceof TagReferenceError) {
      avisarRecusaDeEtiqueta(ROTA_DO_PATCH, err.code, keyId);
      return fail(err.code, err.message, err.status);
    }
    if (err instanceof ContactError) {
      return fail(err.status === 400 ? 'bad_request' : 'internal', err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
