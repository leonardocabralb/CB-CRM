// ============================================================
// Shared contact logic for the public API (v1) contact endpoints.
//
// Kept out of the route files so `GET/POST /api/v1/contacts` and
// `GET/PATCH /api/v1/contacts/{id}` share one serializer, one
// find-or-create (built on the same `findExistingContact` dedupe the
// webhook and send path use), and one tag-sync routine.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { fichaQueVenceu, findExistingContact, isUniqueViolation } from '@/lib/contacts/dedupe';
import { chaveDeTag } from '@/lib/contacts/chave-de-tag';
import {
  type CatalogoDeTags,
  lerCatalogoDeTags,
  resolveImportTagIds,
} from '@/lib/contacts/resolve-import-tags';
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events';
import { type MotivoDoTelefone, telefoneDigitado } from '@/lib/contacts/telefone';

import { casarReferencias, erroDeIdsDesconhecidos } from './tags-do-contato';

/** Row select that embeds the contact's tags for serialization. */
export const CONTACT_SELECT = '*, contact_tags(tags(*))';

export interface ApiContact {
  id: string;
  /**
   * `null` em contato só do Instagram (989) — ele carrega `instagram_id` — e
   * no que a Meta manda só com o nome de usuário do WhatsApp (1041) — ele
   * carrega `whatsapp_user_id`.
   */
  phone: string | null;
  name: string | null;
  email: string | null;
  company: string | null;
  avatar_url: string | null;
  instagram_id: string | null;
  instagram_username: string | null;
  /**
   * O BSUID do WhatsApp (Fase 11, decisão do operador de 24/09/2026: só
   * leitura) — a identidade que a Meta manda de quem adotou nome de usuário,
   * às vezes SEM o telefone. Sem ele, o integrador recebia `phone: null` sem
   * identificador nenhum. Coluna `wa_user_id`.
   */
  whatsapp_user_id: string | null;
  /** O `@` do WhatsApp, sem a arroba, quando a Meta o manda (`wa_username`). */
  whatsapp_username: string | null;
  tags: { id: string; name: string; color: string }[];
  created_at: string;
  updated_at: string;
}

/** Thrown by the helpers below; routes map `.status`/`.message`. */
export class ContactError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ContactError';
    this.status = status;
  }
}

type RawTagJoin = { tags: { id: string; name: string; color: string } | null };

/** Flatten a `CONTACT_SELECT` row into the public contact shape. */
export function serializeContact(row: Record<string, unknown>): ApiContact {
  const joins = (row.contact_tags as RawTagJoin[] | undefined) ?? [];
  return {
    id: row.id as string,
    phone: (row.phone as string | null) ?? null,
    name: (row.name as string | null) ?? null,
    email: (row.email as string | null) ?? null,
    company: (row.company as string | null) ?? null,
    avatar_url: (row.avatar_url as string | null) ?? null,
    instagram_id: (row.instagram_id as string | null) ?? null,
    instagram_username: (row.instagram_username as string | null) ?? null,
    whatsapp_user_id: (row.wa_user_id as string | null) ?? null,
    whatsapp_username: (row.wa_username as string | null) ?? null,
    tags: joins
      .map((j) => j.tags)
      .filter((t): t is NonNullable<RawTagJoin['tags']> => t != null)
      .map((t) => ({ id: t.id, name: t.name, color: t.color })),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

/**
 * Resolve the audit `user_id` for API-created rows — the SINGLE source
 * of truth used by every public-API write (contacts, messages,
 * broadcasts, resolve-conversation), so the same key's writes are
 * always attributed to the same human. API callers have no logged-in
 * user, so we attribute writes to the ACCOUNT OWNER
 * (`accounts.owner_user_id`, NOT NULL e ON DELETE RESTRICT).
 *
 * ⚠️ NOSSO (decisão 7 da Fase 11): nunca `whatsapp_config.user_id` (quem
 * conectou o número), que era a convenção herdada do webhook.
 * `contacts.user_id` e `conversations.user_id` CASCADEiam de `auth.users`:
 * apagar o login de quem conectou levaria junto os clientes que a API criou.
 * Leitura que falha ou conta sem dono = 500, nunca queda para outra pessoa.
 */
export async function resolveAuditUserId(
  db: SupabaseClient,
  accountId: string
): Promise<string> {
  const { data: account, error } = await db
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  const owner = account?.owner_user_id as string | undefined;
  if (error || !owner) {
    throw new ContactError('Account owner could not be resolved', 500);
  }
  return owner;
}

/**
 * A frase do 400 quando o telefone que o integrador mandou não passa pela
 * régua (`telefoneDigitado`). Uma só para `phone` (contatos) e `to`
 * (mensagens), para as duas portas explicarem a mesma regra do mesmo jeito.
 */
export function mensagemDoTelefoneDaApi(campo: string, motivo: MotivoDoTelefone): string {
  const regra =
    'Write a Brazilian number with its area code (e.g. 81 98874-5316 — without + and without a country code it gets 55) or any other country\'s with + and the country code (e.g. +14155550123).';
  if (motivo === 'vazio') return `'${campo}' is required`;
  if (motivo === 'curto') return `'${campo}' is too short (missing the area code?). ${regra}`;
  return `'${campo}' is not a valid phone number. ${regra}`;
}

export interface ContactInput {
  /**
   * O telefone COMO CHEGOU no corpo, nunca já normalizado: a régua lê o `+`
   * para saber se o código do país foi escrito, e "4155551212" (os dígitos
   * de um "+41 55 555 12 12" suíço) relido sem ele ganharia o 55.
   */
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/**
 * Find (by fuzzy phone match) or create a contact in `accountId`.
 * Returns the contact id and whether it was created. Reuses the shared
 * `findExistingContact` dedupe + unique-violation race backstop so an
 * API-created contact is indistinguishable from a webhook-created one.
 */
export async function findOrCreateContact(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  input: ContactInput
): Promise<{ id: string; created: boolean }> {
  // O telefone do integrador passa pela MESMA régua das telas (Fase 3-III do
  // merge do upstream): "(81) 98874-5316" ganha o 55 — cru, virava a ficha
  // "81988745316", que sai para +81 — e texto com letra é recusado, o que
  // inclui um JID colado (`…@lid`, `…@s.whatsapp.net`): apagar as letras e
  // ficar com os dígitos faria do LID um telefone de ficha.
  const telefone = telefoneDigitado(input.phone);
  if (!telefone.ok) {
    throw new ContactError(mensagemDoTelefoneDaApi('phone', telefone.motivo), 400);
  }
  const sanitized = telefone.digitos;

  // ⚠️ Erro de banco NÃO é "não encontrado" — a lição da própria v1 no
  // CLAUDE.md: um timeout tratado como "não achei" faz a rota CRIAR de novo
  // e o integrador duplica a ficha. 500 deixa o n8n reencaminhar.
  const busca = await findExistingContact(db, accountId, sanitized);
  if (busca.falhou) throw new ContactError('Failed to look up contact', 500);
  const existing = busca.contato;
  if (existing) return { id: existing.id, created: false };

  const { data: created, error } = await db
    .from('contacts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      phone: sanitized,
      name: input.name ?? sanitized,
      email: input.email ?? null,
      company: input.company ?? null,
    })
    .select('id')
    .single();

  if (error || !created) {
    // Lost a race against a concurrent create — the unique index (exato ou,
    // desde a 1024, o canônico do nono dígito) rejected the duplicate.
    // Re-resolve to the winner.
    if (isUniqueViolation(error)) {
      const raced = (await fichaQueVenceu(db, accountId, sanitized))
        .contato;
      if (raced) return { id: raced.id, created: false };
    }
    console.error('[api/v1/contacts] create error:', error);
    throw new ContactError('Failed to create contact', 500);
  }

  return { id: created.id, created: true };
}

/**
 * O que o `tags: [...]` do corpo pediu, já lido contra o catálogo da conta.
 * Sai de `lerTagsPedidas`, sem escrita; `setContactTags` é quem escreve.
 */
export interface TagsPedidas {
  /** Ids das etiquetas que JÁ existem — pedidas por nome ou por id —, sem repetição. */
  ids: string[];
  /** Nomes que ainda não existem na conta; `setContactTags` os cria. */
  nomesNovos: string[];
}

/**
 * Fase 1 do verbo substitutivo — SÓ LEITURA. Aceita nome OU id de etiqueta
 * (`casarReferencias`, a mesma régua do aditivo) e estoura 400
 * `unknown_tag_ids` (`TagReferenceError`) com o id que não é desta conta.
 *
 * ⚠️⚠️ Existe separada de `setContactTags` para as rotas chamarem ANTES de
 * qualquer escrita. `POST /contacts` cria a ficha e `PATCH /contacts/{id}`
 * grava nome/e-mail/empresa antes das etiquetas: com a conferência só lá no
 * fim, o id errado devolvia 400 sobre um contato JÁ criado ou JÁ alterado, e
 * o integrador leria "nada aconteceu".
 */
export async function lerTagsPedidas(
  db: SupabaseClient,
  accountId: string,
  textos: string[]
): Promise<TagsPedidas> {
  let catalogo: CatalogoDeTags;
  try {
    catalogo = await lerCatalogoDeTags(db, accountId);
  } catch (error) {
    console.error('[api/v1/contacts] tag catalog read error:', error);
    throw new ContactError("Failed to read the account's tags", 500);
  }
  const { itens, idsDesconhecidos } = casarReferencias(textos, catalogo);
  if (idsDesconhecidos.length > 0) {
    throw erroDeIdsDesconhecidos(idsDesconhecidos);
  }
  return {
    ids: itens.flatMap((i) => (i.id ? [i.id] : [])),
    nomesNovos: itens.flatMap((i) => (i.id ? [] : [i.pedido])),
  };
}

/**
 * Fase 2 — replace a contact's tags to exactly match `pedidas` (missing
 * NAMES are created; ids were already checked by `lerTagsPedidas`). Pass an
 * empty `TagsPedidas` to clear all tags. Reuses `resolveImportTagIds` for
 * the creation so API and CSV-import tag handling stay consistent.
 *
 * ⚠️⚠️ O id da etiqueta pedida chega aqui JÁ RESOLVIDO. Até 22/09/2026 esta
 * função só conhecia nome: um `PATCH` com `tags: ["<id do Typebot>"]` criava
 * uma etiqueta NOVA chamada com o UUID, aplicava-a, e — o pior — o id não
 * casava com a etiqueta real, então o "Typebot" que o contato já tinha ia
 * para `toRemove`. O integrador pedia para MANTER e a API tirava.
 *
 * `somenteAcrescentar` é o `tags_mode: "add"` das duas rotas: aplica as
 * pedidas e NUNCA calcula nem apaga `toRemove`. Reaproveita o `TagsPedidas`
 * que `lerTagsPedidas` já resolveu antes da primeira escrita — e não o
 * `aplicarMudancaDeTags` do verbo aditivo, que relê o catálogo e poderia
 * levantar `TagReferenceError` DEPOIS de o contato já ter sido criado.
 */
export async function setContactTags(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  contactId: string,
  pedidas: TagsPedidas,
  opcoes: { somenteAcrescentar?: boolean } = {}
): Promise<void> {
  // ⚠️⚠️ SÓ as etiquetas PEDIDAS, nunca `tagIdByKey.values()`.
  //
  // `resolveImportTagIds` devolve o CATÁLOGO INTEIRO da conta chaveado por
  // nome (é assim desde sempre — o import de CSV consulta esse mapa por
  // nome, linha a linha). Tomar os `values()` como "as etiquetas desejadas"
  // fazia `PATCH /api/v1/contacts/{id}` com QUALQUER `tags` não-vazio
  // aplicar TODAS as etiquetas da conta ao contato, em vez das pedidas — e
  // a doc pública promete "replace the contact's tags".
  //
  // Defeito ANTIGO, achado só em 09/09/2026 na verificação e2e da 983:
  // `contact_tags` estava zerada em produção e não havia chave de API ativa,
  // então o caminho nunca tinha rodado com etiqueta de verdade. `tags: []`
  // continua limpando tudo (a lista de pedidos é vazia).
  const desired = new Set(pedidas.ids);

  if (pedidas.nomesNovos.length > 0) {
    const { tagIdByKey, skippedNames } = await resolveImportTagIds(db, {
      accountId,
      userId: auditUserId,
      tagNames: pedidas.nomesNovos,
      canCreateTags: true,
    });

    // ⚠️⚠️ Nome pedido que NÃO resolveu tem de ESTOURAR, nunca ser ignorado.
    //
    // Este verbo SUBSTITUI o conjunto: o que não entra em `desired` entra em
    // `toRemove` logo abaixo. Descartar um nome irresolvido em silêncio,
    // portanto, não é "aplicar menos" — é APAGAR do contato justamente a
    // etiqueta que o chamador acabou de pedir para manter. Um `PATCH` com
    // `tags: ["Bancário"]` tiraria "Bancário" do contato.
    //
    // Com `canCreateTags: true`, um nome só cai em `skippedNames` quando a
    // criação não materializou (o helper explica os casos). É problema de
    // servidor, e 500 é a resposta honesta: a substituição pedida não pôde
    // ser feita. (Achado da revisão adversarial.) O nome com cara de UUID —
    // que o helper recusa criar — nunca chega aqui: `lerTagsPedidas` o lê
    // como id.
    if (skippedNames.length > 0) {
      throw new ContactError(
        `Could not resolve tags: ${skippedNames.join(', ')}`,
        500
      );
    }
    for (const nome of pedidas.nomesNovos) {
      const id = tagIdByKey.get(chaveDeTag(nome));
      if (id) desired.add(id);
    }
  }

  // Diff against the current joins rather than delete-all-then-insert:
  // a diff only touches tags that actually change, so a mid-operation
  // failure can never wipe tags that were meant to stay. Every write
  // is error-checked and surfaced as a ContactError (→ 500) instead of
  // being swallowed behind a misleading 200.
  const { data: current, error: readErr } = await db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', contactId);
  if (readErr) {
    throw new ContactError('Failed to read contact tags', 500);
  }
  const existing = new Set((current ?? []).map((r) => r.tag_id as string));

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = opcoes.somenteAcrescentar
    ? []
    : [...existing].filter((id) => !desired.has(id));

  if (toRemove.length > 0) {
    const { error } = await db
      .from('contact_tags')
      .delete()
      .eq('contact_id', contactId)
      .in('tag_id', toRemove);
    if (error) throw new ContactError('Failed to update contact tags', 500);
  }
  if (toAdd.length > 0) {
    for (const tagId of toAdd) {
      try {
        await addContactTagAndDispatch({
          db,
          accountId,
          contactId,
          tagId,
        });
      } catch (error) {
        console.error('[api/v1/contacts] tag add failed:', error);
        throw new ContactError('Failed to update contact tags', 500);
      }
    }
  }
}

/**
 * Fetch + serialize a single contact scoped to the account.
 *
 * `null` significa AUSENTE — o contato não existe nesta conta.
 *
 * ⚠️⚠️ Erro de banco ESTOURA (`ContactError`, 500); ele nunca vira `null`.
 * Enquanto os dois eram o mesmo `null`, todo chamador transformava um
 * timeout do PostgREST em **404 "Contact not found"** sobre um contato que
 * existe — e o integrador, lendo 404, recria a ficha. São quatro chamadores
 * (`GET`/`PATCH /contacts/{id}` e o `POST /contacts`), e no `PATCH` a
 * releitura acontece DEPOIS da escrita, então o 404 vinha logo após o
 * contato ter sido alterado com sucesso.
 *
 * É a regra da casa escrita no CLAUDE.md ("erro de banco não é 'não
 * encontrado'"), e este helper era a maior exceção a ela. (Achado da
 * revisão adversarial.)
 */
export async function getContactById(
  db: SupabaseClient,
  accountId: string,
  contactId: string
): Promise<ApiContact | null> {
  const { data, error } = await db
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('id', contactId)
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    console.error('[api/v1/contacts] getContactById error:', error);
    throw new ContactError('Failed to load contact', 500);
  }
  if (!data) return null;
  return serializeContact(data as Record<string, unknown>);
}
