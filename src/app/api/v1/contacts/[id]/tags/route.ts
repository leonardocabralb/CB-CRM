// ============================================================
// POST /api/v1/contacts/{id}/tags — tags ADITIVAS (scope: contacts:write)
//
// Corpo: { add?: string[], remove?: string[], create_missing?: boolean }
// Acrescenta e retira por NOME ou por ID de etiqueta (misturados, se
// quiser), sem tocar nas demais tags do contato. Id que não é desta conta
// = 400 `unknown_tag_ids`, antes de qualquer escrita; id nunca cria
// etiqueta. Os baldes da resposta levam o nome GRAVADO da etiqueta, nunca
// o UUID cru. A régua mora em `src/lib/api/v1/tags-do-contato.ts`.
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
  badRequest,
  fail,
  ok,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  getContactById,
  idAtualDaFicha,
  resolveAuditUserId,
  ContactError,
} from '@/lib/api/v1/contacts';
import {
  aplicarMudancaDeTags,
  avisarRecusaDeEtiqueta,
  lerMudancaDeTags,
  TagReferenceError,
} from '@/lib/api/v1/tags-do-contato';
import { ContactTagWriteError } from '@/lib/contacts/tag-write';
import { ehUuid } from '@/lib/tasks/validar';

const ROTA = 'POST /api/v1/contacts/{id}/tags';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Fora do `try`: o `catch` registra o 400 de etiqueta com o id da chave.
  let keyId: string | null = null;
  try {
    const ctx = await requireApiKey(request, 'contacts:write');
    keyId = ctx.keyId;
    const { id: idPedido } = await params;
    if (!ehUuid(idPedido)) throw badRequest("'id' must be a UUID");

    const corpo = await request.json().catch(() => null);
    const leitura = lerMudancaDeTags(corpo);
    if (!leitura.ok) {
      avisarRecusaDeEtiqueta(ROTA, 'bad_request', keyId);
      throw badRequest(leitura.erro);
    }

    // O contato é DESTA conta? Id de ficha UNIDA a outra (1092) aplica na
    // que ficou. Erro de banco estoura como 500 antes de qualquer conclusão
    // de ausência.
    const id = await idAtualDaFicha(ctx.supabase, ctx.accountId, idPedido);
    if (!id) return fail('not_found', 'Contact not found', 404);

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
    //
    // ⚠️⚠️ Esta releitura acontece DEPOIS de a etiqueta ter sido gravada e de
    // o gatilho `tag_added` ter disparado: um timeout lido como "não existe"
    // viraria 404 sobre um contato que acabou de ser alterado, e o
    // integrador recriaria a ficha. `getContactById` ESTOURA em erro de
    // banco (`ContactError` 500, tratado no catch) e só devolve `null` para
    // ausência de verdade — o contato apagado por outra requisição ENTRE a
    // escrita e a releitura.
    const contato = await getContactById(ctx.supabase, ctx.accountId, id);
    if (!contato) return fail('not_found', 'Contact not found', 404);

    return ok({ contact: contato, ...resultado });
  } catch (err) {
    // Id que não é desta conta, ou a mesma etiqueta nos dois lados por
    // nome e por id — os dois antes de qualquer escrita.
    if (err instanceof TagReferenceError) {
      avisarRecusaDeEtiqueta(ROTA, err.code, keyId);
      return fail(err.code, err.message, err.status);
    }
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
