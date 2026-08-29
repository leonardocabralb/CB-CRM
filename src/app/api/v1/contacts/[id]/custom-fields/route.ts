// ============================================================
// /api/v1/contacts/{id}/custom-fields — valores por CHAVE (Fase 6).
//
// GET   (scope: custom_fields:read)  — catálogo da conta com os valores
//         deste contato, endereçados por `field_key` (948).
// PATCH (scope: custom_fields:write) — grava valores por chave.
//         `""`/null limpam; chave desconhecida é 400 com a lista.
//
// É a porta que o n8n do gestor usa para preencher o traqueamento
// (utm_*, fbclid, ctwa_clid…) na entrada do lead e ler tudo de volta na
// hora de mandar para a API de Conversões — o CRM é o depósito; a
// orquestração vive fora (decisão do operador, 2026-08-29).
//
// ⚠️ Regras de toda rota v1 (CLAUDE.md): roda em SERVICE-ROLE, então
// TODA consulta — inclusive as auxiliares — filtra por
// `ctx.accountId`; erro de banco vira 500, nunca 404 (um timeout lido
// como "não existe" faria o integrador recriar o contato).
//
// A escrita reusa `salvarValoresDoContato` — o MESMO caminho das telas
// (upsert + delete dos esvaziados). A posse do contato é conferida
// aqui; os ids de campo saem do catálogo já filtrado pela conta.
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import {
  ApiError,
  fail,
  badRequest,
  ok,
  toApiErrorResponse,
} from '@/lib/api/v1/respond';
import {
  MAX_VALOR,
  prepararEscritaPorChave,
  serializeCustomFields,
} from '@/lib/api/v1/custom-fields';
import { salvarValoresDoContato } from '@/lib/contacts/custom-values';
import { ehUuid } from '@/lib/tasks/validar';
import type { CustomField } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Carrega contato (posse), catálogo e valores — o trio que os dois verbos
 * precisam. Devolve `null` só quando o CONTATO não existe NA CONTA; erro
 * de banco estoura como 500 antes de qualquer conclusão de ausência.
 */
async function carregar(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<{ fields: CustomField[]; values: Record<string, string> } | null> {
  const { data: contato, error: contatoErr } = await db
    .from('contacts')
    .select('id')
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (contatoErr) {
    console.error('[api/v1/custom-fields] contact lookup error:', contatoErr);
    // ⚠️ Erro de banco NUNCA vira "não encontrado" (regra do CLAUDE.md):
    // timeout lido como 404 faria o integrador recriar o contato.
    throw new ApiError('internal', 'Failed to load contact', 500);
  }
  if (!contato) return null;

  const [fieldsRes, valuesRes] = await Promise.all([
    db
      .from('custom_fields')
      .select('*')
      .eq('account_id', accountId)
      .order('field_name'),
    db
      .from('contact_custom_values')
      .select('custom_field_id, value')
      .eq('contact_id', contactId),
  ]);
  if (fieldsRes.error || valuesRes.error) {
    console.error(
      '[api/v1/custom-fields] load error:',
      fieldsRes.error ?? valuesRes.error
    );
    throw new ApiError('internal', 'Failed to load custom fields', 500);
  }

  const values: Record<string, string> = {};
  for (const v of valuesRes.data ?? []) {
    values[v.custom_field_id as string] = (v.value as string | null) ?? '';
  }
  return { fields: (fieldsRes.data ?? []) as CustomField[], values };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'custom_fields:read');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const dados = await carregar(ctx.supabase, ctx.accountId, id);
    if (!dados) return fail('not_found', 'Contact not found', 404);

    return ok({
      contact_id: id,
      ...serializeCustomFields(dados.fields, dados.values),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireApiKey(request, 'custom_fields:write');
    const { id } = await params;
    if (!ehUuid(id)) throw badRequest("'id' must be a UUID");

    const body = (await request.json().catch(() => null)) as {
      values?: unknown;
    } | null;
    if (
      !body ||
      typeof body.values !== 'object' ||
      body.values === null ||
      Array.isArray(body.values)
    ) {
      throw badRequest("'values' must be an object of { field_key: value }");
    }
    if (Object.keys(body.values).length === 0) {
      throw badRequest("'values' is empty — nothing to write");
    }

    const dados = await carregar(ctx.supabase, ctx.accountId, id);
    if (!dados) return fail('not_found', 'Contact not found', 404);

    const escrita = prepararEscritaPorChave(
      dados.fields,
      body.values as Record<string, unknown>
    );
    if (!escrita.ok) {
      // Um corpo com 10k chaves erradas não pode ecoar as 10k na mensagem —
      // as primeiras 20 diagnosticam o typo igual.
      const resumo = (chaves: string[]) =>
        chaves.slice(0, 20).join(', ') +
        (chaves.length > 20 ? `, … (+${chaves.length - 20})` : '');
      const partes: string[] = [];
      if (escrita.desconhecidas.length > 0) {
        partes.push(`unknown field keys: ${resumo(escrita.desconhecidas)}`);
      }
      if (escrita.invalidas.length > 0) {
        partes.push(
          `values must be string, number, boolean or null: ${resumo(escrita.invalidas)}`
        );
      }
      if (escrita.datasInvalidas.length > 0) {
        partes.push(
          `datetime fields require an ISO-8601 instant with an explicit offset, e.g. "2026-08-30T14:00:00-03:00" or "...Z": ${resumo(escrita.datasInvalidas)}`
        );
      }
      if (escrita.longas.length > 0) {
        partes.push(
          `values longer than ${MAX_VALOR} characters: ${resumo(escrita.longas)}`
        );
      }
      throw badRequest(partes.join('; '));
    }

    const erro = await salvarValoresDoContato(ctx.supabase, id, escrita.porId);
    if (erro) {
      console.error('[api/v1/custom-fields] write error:', erro);
      return fail('internal', 'Failed to save custom field values', 500);
    }

    // Estado pós-escrita — o n8n confirma o que ficou sem uma 2ª chamada.
    const depois = await carregar(ctx.supabase, ctx.accountId, id);
    if (!depois) return fail('not_found', 'Contact not found', 404);
    return ok({
      contact_id: id,
      ...serializeCustomFields(depois.fields, depois.values),
    });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
