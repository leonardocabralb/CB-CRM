import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarPorChave, PAGINA } from '@/lib/supabase/paginar'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'

// ============================================================
// Knowledge base: ingest (chunk + optionally embed) and hybrid
// retrieve (semantic when an embeddings key is present, topped up with
// lexical full-text search).
// ============================================================

interface MatchRow {
  id: string
  content: string
}

/** Ids por DELETE: 100 uuids cabem folgados na URL do PostgREST. */
const TRECHOS_POR_EXCLUSAO = 100

/**
 * (Re)build the chunks for one document: re-chunk the content and — when
 * the account has an embeddings key — embed each chunk. Runs under
 * whatever client the caller passes (the ingest routes pass the admin's
 * session client).
 *
 * ⚠️ Os trechos ANTIGOS só saem depois de os novos estarem gravados (porte
 * do #683 do original): apagando primeiro, o documento ficava sem trecho
 * nenhum durante o embedding (chamada paga, segundos) e PARA SEMPRE se o
 * INSERT falhasse — a busca do agente e do rascunho não achava nada. Agora:
 * vetores → lista dos ids antigos (POR CHAVE: o PostgREST corta em 1000 sem
 * avisar, e o excedente sobraria duplicado) → INSERT dos novos → DELETE dos
 * antigos por id, em lotes. Leitura ou INSERT que falha não muda nada: os
 * antigos continuam servindo.
 *
 * Throws on embedding failure so the ingest route can report it — but only
 * AFTER the (embedding-less) rows are stored, so the document stays
 * searchable lexically and "semantic indexing failed" is the truth.
 */
export async function ingestDocument(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = chunkText(content)

  // Embed if a key is set, but DON'T let an embedding failure stop the
  // chunks from being stored: a failed embed must still leave the
  // document searchable lexically. We record the error and rethrow it
  // AFTER inserting (embedding-less) rows, so the route can warn
  // "semantic indexing failed" — which is now truthful, because lexical
  // search really does still work.
  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey && chunks.length > 0) {
    try {
      embeddings = await embedTexts(config.embeddingsApiKey, chunks)
    } catch (err) {
      embedError = err
    }
  }

  // Os ids de ANTES do INSERT: depois dele a lista traria os novos junto.
  const antigos = await buscarPorChave<{ id: string }>(async (depoisDe) => {
    let consulta = db
      .from('ai_knowledge_chunks')
      .select('id')
      .eq('account_id', accountId)
      .eq('document_id', documentId)
    if (depoisDe) consulta = consulta.gt('id', depoisDe)
    const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA)
    return { data: (data ?? null) as { id: string }[] | null, error }
  })
  if (!antigos.linhas) {
    throw new Error(
      `knowledge chunks of ${documentId} not listed (${antigos.motivo}): ${antigos.erro?.message ?? ''}`,
    )
  }

  if (chunks.length > 0) {
    const rows = chunks.map((content, i) => ({
      document_id: documentId,
      account_id: accountId,
      chunk_index: i,
      content,
      embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
    }))

    const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
    if (insErr) throw insErr
  }

  const ids = antigos.linhas.map((linha) => linha.id)
  for (let i = 0; i < ids.length; i += TRECHOS_POR_EXCLUSAO) {
    const { error: delErr } = await db
      .from('ai_knowledge_chunks')
      .delete()
      .eq('document_id', documentId)
      .in('id', ids.slice(i, i + TRECHOS_POR_EXCLUSAO))
    if (delErr) throw delErr
  }

  if (embedError) throw embedError
}

/**
 * Retrieve up to `k` knowledge excerpts relevant to `queryText`.
 *
 * Semantic-primary when an embeddings key is configured (embed the
 * query → cosine-nearest chunks), then topped up with lexical full-text
 * matches to fill `k`. Lexical-only when there's no key. Best-effort:
 * any failure (no KB, embedding error, RPC error) degrades to fewer or
 * zero results and never throws into the draft / auto-reply path.
 */
export async function retrieveKnowledge(
  db: SupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  queryText: string,
  k = 5,
  /** Canal da conversa. Recorta o acervo: sem ele, um lead que pergunta
   *  honorarios no Comercial podia receber trecho da tabela interna do
   *  Juridico. `null` = sem recorte (todo o acervo da conta). */
  channelId: string | null = null,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []

  // Skip everything when the account has no knowledge base — otherwise
  // every draft / auto-reply would pay for a query embedding + two RPCs
  // just to get []. One cheap indexed COUNT (head, no rows) instead of a
  // paid embeddings call on the hot path.
  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return []
  } catch {
    return []
  }

  const picked = new Map<string, string>() // id → content, preserves order

  // Semantic path.
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
          // NULL no chunk = documento comum a todos os canais; NULL aqui =
          // sem recorte. Nunca esconde o acervo anterior a 903.
          p_channel_id: channelId ?? null,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  // Lexical top-up (also the sole path when there's no embeddings key).
  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
        p_channel_id: channelId ?? null,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  return Array.from(picked.values()).slice(0, k)
}
