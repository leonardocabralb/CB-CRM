import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { ingestDocument } from '@/lib/ai/knowledge'
import { AiError, mensagemSeguraDeAiError } from '@/lib/ai/types'

/**
 * POST /api/ai/knowledge/reindex  (admin+)
 *
 * Re-chunk and re-embed every document in the account. The main use is
 * after adding an embeddings key: existing documents were stored
 * lexical-only, and this backfills their vectors so semantic search
 * turns on. Also recovers documents whose indexing failed earlier.
 *
 * É a base da CONTA (`ai_knowledge_documents`/`ai_knowledge_chunks`): a do
 * rascunho ✨ e a dos agentes de IA (1052), que só marcam quais documentos
 * cada agente consulta (`cb_ia_agente_documentos`) e buscam nos mesmos
 * trechos. Reindexar aqui refaz o que os agentes leem.
 *
 * Porte do upstream #676: um documento que falha não para os outros. A
 * resposta diz o total, quantos reindexaram e QUAIS falharam (`failed`, os
 * ids; a tela troca pelo título), com o motivo do primeiro (`motivo`, a
 * mensagem segura). Antes, a primeira falha encerrava a rodada e o resto da
 * base ficava como estava, sem a tela saber quais.
 *
 * ⚠️ NOSSO (diverge do original): a falha DO PROVEDOR de vetores (`AiError`)
 * continua encerrando a rodada. `ingestDocument` apaga os trechos antigos
 * ANTES de gerar os vetores, e a falha do provedor quase sempre é da conta
 * (chave recusada, cota, provedor fora do ar): seguir deixaria TODOS os
 * documentos só com busca por palavra, em vez de um. Segue adiante só a
 * falha que é do documento (banco).
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-reindex:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const { data: docs, error } = await supabase
      .from('ai_knowledge_documents')
      .select('id, content')
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/knowledge/reindex] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load documents' },
        { status: 500 },
      )
    }

    const { key: embeddingsApiKey, corrupt } = await loadEmbeddingsKey(
      supabase,
      accountId,
    )
    // The whole point of Reindex is usually to backfill embeddings — so
    // if a key is configured but can't be decrypted, don't quietly do a
    // lexical-only pass and report success. Stop and tell the admin.
    if (corrupt) {
      return NextResponse.json(
        {
          success: false,
          reindexed: 0,
          error:
            'Your embeddings key could not be decrypted (check ENCRYPTION_KEY, then re-enter the key in Settings → AI Assistant). Nothing was reindexed.',
        },
        { status: 200 },
      )
    }

    const total = (docs ?? []).length
    let reindexed = 0
    const failed: string[] = []
    let motivo: string | null = null
    for (const doc of docs ?? []) {
      try {
        await ingestDocument(supabase, accountId, { embeddingsApiKey }, doc.id, doc.content)
        reindexed += 1
      } catch (err) {
        // Ver a nota irmã em `knowledge/route.ts`: `invalid_key` ecoa a chave
        // — nem o log nem a tela recebem a mensagem crua de um `AiError`.
        // Erro que não é do provedor (banco) não carrega chave: vai inteiro
        // para o log, e a tela recebe só o genérico.
        const seguro = err instanceof AiError ? mensagemSeguraDeAiError(err) : null
        console.error(`[ai/knowledge/reindex] doc ${doc.id} failed:`, seguro ?? err)
        failed.push(doc.id)
        motivo ??= seguro ?? 'indexing failed'
        // A falha do PROVEDOR encerra a rodada (ver o cabeçalho): os
        // documentos seguintes guardam os vetores que têm.
        if (err instanceof AiError) break
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      reindexed,
      total,
      failed,
      ...(motivo ? { motivo } : {}),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
