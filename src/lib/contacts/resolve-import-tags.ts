import type { SupabaseClient } from '@supabase/supabase-js';

import { chaveDeTag } from './chave-de-tag';

const DEFAULT_TAG_COLOR = '#3b82f6';

export interface ResolveImportTagsResult {
  /** `chaveDeTag(nome)` → id da etiqueta. */
  tagIdByKey: Map<string, string>;
  /** Names that could not be matched and were not created. */
  skippedNames: string[];
}

/**
 * Resolve nomes de etiqueta para ids. Usado pelas TRÊS portas que criam
 * etiqueta: o import de CSV, o `PATCH /api/v1/contacts/{id}` (substitutivo)
 * e o `POST /api/v1/contacts/{id}/tags` (aditivo). Nome que não existe é
 * criado quando `canCreateTags` é true (admin+); senão volta em
 * `skippedNames`.
 *
 * ⚠️ O casamento é por `chaveDeTag` — sem acento, além de sem caixa. Até a
 * migration 983 era só `toLowerCase()`, e a divergência entre as portas era
 * real: a API aditiva casava sem acento e esta função casava com, então
 * "bancario" num catálogo que tinha "Bancário" criava uma SEGUNDA etiqueta.
 * Hoje a régua é uma só nas três portas E no banco (a coluna gerada
 * `tags.name_key`).
 *
 * ⚠️ A criação é `upsert` com `ON CONFLICT DO NOTHING` sobre o índice único
 * `(account_id, name_key)`, seguida de RELEITURA — nunca ler-então-inserir.
 * Duas requisições concorrentes com o mesmo nome NOVO passavam as duas pela
 * leitura e inseriam as duas; pior, cada uma aplicava a SUA ao contato e o
 * gatilho `tag_added` disparava DUAS vezes, o que numa automação sem
 * etiqueta específica é a mensagem saindo em dobro para o cliente. Com o
 * índice, a segunda inserção não acontece; com a releitura, as duas
 * requisições convergem no MESMO id. (Achado do Codex no PR #150.)
 */
export async function resolveImportTagIds(
  supabase: SupabaseClient,
  params: {
    accountId: string;
    userId: string;
    tagNames: string[];
    canCreateTags: boolean;
    defaultColor?: string;
  }
): Promise<ResolveImportTagsResult> {
  const { accountId, userId, tagNames, canCreateTags } = params;
  const defaultColor = params.defaultColor ?? DEFAULT_TAG_COLOR;

  const uniqueNames: string[] = [];
  const seen = new Set<string>();
  for (const raw of tagNames) {
    const name = raw.trim();
    if (!name) continue;
    // Mesma chave da resolução: "Bancário" e "bancario" na mesma lista
    // resolvem para a MESMA etiqueta, e sobreviverem como dois nomes faria a
    // segunda passagem parecer uma atribuição a mais.
    const key = chaveDeTag(name);
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueNames.push(name);
  }

  if (uniqueNames.length === 0) {
    return { tagIdByKey: new Map(), skippedNames: [] };
  }

  // ⚠️ ORDENADO: quando duas etiquetas colapsam na mesma chave — possível em
  // base anterior à 983, que RENOMEIA em vez de apagar —, vence a MAIS
  // ANTIGA. É a mesma régua do desempate da migration e da leitura de
  // catálogo da API aditiva. Sem o ORDER BY o PostgREST devolve em ordem não
  // determinística e duas chamadas iguais escolheriam etiquetas diferentes.
  const lerCatalogo = async (): Promise<Map<string, string>> => {
    const { data, error } = await supabase
      .from('tags')
      .select('id, name')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;

    const mapa = new Map<string, string>();
    for (const tag of data ?? []) {
      const chave = chaveDeTag(tag.name as string);
      if (!mapa.has(chave)) mapa.set(chave, tag.id as string);
    }
    return mapa;
  };

  let tagIdByKey = await lerCatalogo();

  const skippedNames: string[] = [];
  const toCreate: string[] = [];

  for (const name of uniqueNames) {
    if (tagIdByKey.has(chaveDeTag(name))) continue;
    if (canCreateTags) toCreate.push(name);
    else skippedNames.push(name);
  }

  if (toCreate.length > 0) {
    // `ignoreDuplicates` devolve SÓ as linhas realmente inseridas — quem
    // perdeu a corrida não volta aqui. Por isso o id sai da releitura
    // abaixo, e não do retorno: é ela que faz as duas requisições
    // convergirem no mesmo id.
    const { error: createError } = await supabase
      .from('tags')
      .upsert(
        toCreate.map((name) => ({
          user_id: userId,
          account_id: accountId,
          name,
          color: defaultColor,
        })),
        { onConflict: 'account_id,name_key', ignoreDuplicates: true }
      )
      .select('id');

    if (createError) throw createError;

    tagIdByKey = await lerCatalogo();

    // Sobrou nome que nem existia nem foi criado? Reportar como pulado é
    // melhor que devolver um mapa incompleto em silêncio, que faria o
    // chamador atribuir menos etiquetas do que pediu e não perceber.
    //
    // ⚠️ NÃO é o caso de RLS. Uma versão anterior deste comentário dizia que
    // "inserção barrada por RLS devolve 0 linhas sem erro" — isso vale para
    // UPDATE e DELETE (a cláusula USING filtra as linhas), mas INSERT é
    // diferente: o WITH CHECK ESTOURA. Medido em 2026-09-09 com
    // `SET ROLE authenticated`: SQLSTATE 42501, "new row violates row-level
    // security policy for table \"tags\"". Esse caminho sai pelo `throw
    // createError` acima.
    //
    // O que sobra aqui é a releitura não enxergar o que acabou de ser
    // escrito — atraso de réplica, ou alguém apagando a etiqueta entre as
    // duas chamadas. Raro, e é justamente por ser raro que precisa aparecer
    // em vez de sumir.
    for (const name of toCreate) {
      if (!tagIdByKey.has(chaveDeTag(name))) skippedNames.push(name);
    }
  }

  return { tagIdByKey, skippedNames };
}

export interface ContactTagAssignment {
  contactId: string;
  tagNames: string[];
}

/**
 * Insert contact_tags rows for imported contacts (ignores duplicates).
 *
 * Returns the number of contact–tag pairs *requested* for upsert, not
 * rows actually inserted — `ignoreDuplicates` can drop pairs that already
 * exist without changing the returned count.
 */
export async function assignImportedContactTags(
  supabase: SupabaseClient,
  assignments: ContactTagAssignment[],
  tagIdByKey: Map<string, string>
): Promise<number> {
  const rows: { contact_id: string; tag_id: string }[] = [];

  for (const { contactId, tagNames } of assignments) {
    const assignedTagIds = new Set<string>();
    for (const name of tagNames) {
      const tagId = tagIdByKey.get(chaveDeTag(name));
      if (!tagId || assignedTagIds.has(tagId)) continue;
      assignedTagIds.add(tagId);
      rows.push({ contact_id: contactId, tag_id: tagId });
    }
  }

  if (rows.length === 0) return 0;

  const chunkSize = 100;
  let assigned = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from('contact_tags').upsert(chunk, {
      onConflict: 'contact_id,tag_id',
      ignoreDuplicates: true,
    });
    if (error) throw error;
    assigned += chunk.length;
  }

  return assigned;
}
