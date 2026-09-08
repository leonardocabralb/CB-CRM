// ============================================================
// POST /api/v1/contacts/{id}/tags — tags ADITIVAS (scope: contacts:write)
//
// Corpo: { add?: string[], remove?: string[], create_missing?: boolean }
// Acrescenta e retira POR NOME, sem tocar nas demais tags do contato.
//
// Por que não é `PATCH .../contacts/{id}` com `tags: []`: aquele
// SUBSTITUI o conjunto inteiro e continua assim (contrato publicado).
// Um fluxo externo que quisesse só etiquetar o lead apagaria todo o
// resto da ficha — com 200 na resposta.
//
// Por que POST único em vez de POST/DELETE: (a) "põe X e tira Y" vira
// uma chamada só; (b) `DELETE` com corpo é mal suportado por vários
// clientes HTTP, e nome de tag aqui tem espaço e acento ("Ag. Demissão"),
// o que faria `DELETE .../tags/{nome}` depender de codificação de URL.
//
// ⚠️ Regras de toda rota v1 (CLAUDE.md): roda em SERVICE-ROLE e ignora
// RLS, então toda consulta filtra por `ctx.accountId`; erro de banco
// vira 500, NUNCA 404 — um timeout lido como "não existe" faria o
// integrador recriar o contato, duplicando.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import {
  ApiError,
  badRequest,
  fail,
  ok,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  CONTACT_SELECT,
  resolveAuditUserId,
  serializeContact,
  ContactError,
} from '@/lib/api/v1/contacts';
import {
  aplicarMudancaDeTags,
  lerMudancaDeTags,
} from '@/lib/api/v1/tags-do-contato';
import { ContactTagWriteError } from '@/lib/contacts/tag-write';
import { ehUuid } from '@/lib/tasks/validar';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Confere que o contato é DESTA conta. Devolve `false` só quando ele
 * não existe aqui; erro de banco estoura como 500 antes de qualquer
 * conclusão de ausência.
 *
 * ⚠️ Não usa `getContactById` para isto: aquele helper colapsa erro e
 * vazio no mesmo `null` (`api/v1/contacts.ts`), e a rota transformaria um
 * timeout em 404.
 */
async function contatoEhDaConta(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<boolean> {
  const { data, error } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[api/v1/contacts/tags] contact lookup error:', error);
    throw new ApiError('internal', 'Failed to load contact', 500);
  }
  return Boolean(data);
}

/**
 * Relê o contato para devolver o estado pós-escrita.
 *
 * ⚠️⚠️ Também não usa `getContactById`, e aqui o motivo é PIOR do que na
 * conferência acima: esta leitura acontece DEPOIS de a etiqueta já ter sido
 * gravada e de o gatilho `tag_added` já ter disparado. Com o `null`
 * ambíguo daquele helper, um timeout viraria **404 "Contact not found"**
 * sobre um contato que existe e que acabou de ser alterado — e o
 * integrador, lendo 404, recria a ficha. Resultado: contato duplicado, com
 * a etiqueta e a automação já aplicadas no primeiro.
 */
async function relerContato(
  db: SupabaseClient,
  accountId: string,
  contactId: string
) {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[api/v1/contacts/tags] contact re-read error:', error);
    throw new ApiError('internal', 'Failed to load the updated contact', 500);
  }
  return data ? serializeContact(data as Record<string, unknown>) : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const corpo = await request.json().catch(() => null);
    const leitura = lerMudancaDeTags(corpo);
    if (!leitura.ok) throw badRequest(leitura.erro);

    if (!(await contatoEhDaConta(ctx.supabase, ctx.accountId, id))) {
      return fail('not_found', 'Contact not found', 404);
    }

    const auditUserId = await resolveAuditUserId(ctx.supabase, ctx.accountId);
    const resultado = await aplicarMudancaDeTags(ctx.supabase, {
      accountId: ctx.accountId,
      auditUserId,
      contactId: id,
      mudanca: leitura.mudanca,
    });

    // Estado pós-escrita: quem integra confere o que ficou sem uma 2ª
    // chamada — e o resumo diz o que MUDOU, que é o que permite depurar
    // "apliquei a tag e não aconteceu nada" do lado de fora.
    const contato = await relerContato(ctx.supabase, ctx.accountId, id);
    // Sumiu ENTRE a escrita e a releitura (apagado por outra requisição).
    // Só chega aqui com o `error` já descartado como 500 acima, então este
    // 404 é ausência de verdade.
    if (!contato) return fail('not_found', 'Contact not found', 404);

    return ok({ contact: contato, ...resultado });
  } catch (err) {
    // ⚠️ `ContactTagWriteError` NÃO é `ApiError`: sem este ramo, um
    // "Tag not found" (404) sairia como 500 genérico pelo catch-all.
    if (err instanceof ContactTagWriteError) {
      return fail(
        err.status === 404 ? 'not_found' : 'internal',
        err.status === 404 ? err.message : 'Failed to update contact tags',
        err.status
      );
    }
    if (err instanceof ContactError) {
      return fail(
        err.status === 400 ? 'bad_request' : 'internal',
        err.message,
        err.status
      );
    }
    return toApiErrorResponse(err);
  }
}
