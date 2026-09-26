// ============================================================
// A base de conhecimento DO AGENTE (F3, D20; docs/PLANO-agentes-de-ia.md 5.2).
//
// A mesma busca híbrida de `retrieveKnowledge` (`src/lib/ai/knowledge.ts`):
// por sentido quando há chave de embeddings, completada pela busca por
// palavras — mas pelas funções NOVAS da 1052, que só devolvem os trechos dos
// documentos MARCADOS para o agente (`cb_ia_agente_documentos`).
//
// ⚠️ Nada marcado = NENHUMA base (o "fechado por padrão" do acesso). As
// funções da 0903 dizem o contrário com parâmetro nulo ("sem recorte") e
// continuam servindo ao rascunho; o agente nunca passa por elas.
//
// ⚠️ Agente sem documento = [] com UMA leitura (`cb_ia_agente_documentos`),
// SEM ler a chave de embeddings e sem chamar o provedor: por isso a chave
// chega como FUNÇÃO (`chaveDeEmbeddings`), chamada só quando há o que buscar.
//
// Melhor esforço: erro de leitura, de embedding ou de RPC vira menos trechos
// (ou nenhum), nunca exceção no caminho do turno.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings'
import { latestUserMessage } from '@/lib/ai/query'
import type { ChatMessage } from '@/lib/ai/types'

/** Um trecho recuperado, com o documento de onde veio (é o que o retrato do turno guarda). */
export interface TrechoDaBase {
  id: string
  documentoId: string
  content: string
}

interface LinhaDaBusca {
  id: string
  documento_id: string
  content: string
}

function lerLinhas(data: unknown): LinhaDaBusca[] {
  if (!Array.isArray(data)) return []
  return data.filter(
    (l): l is LinhaDaBusca =>
      !!l &&
      typeof (l as LinhaDaBusca).id === 'string' &&
      typeof (l as LinhaDaBusca).documento_id === 'string' &&
      typeof (l as LinhaDaBusca).content === 'string',
  )
}

/**
 * A consulta à base: a ÚLTIMA mensagem do cliente, sem o rótulo que a
 * conversa põe na frente de mídia (`[audio message, transcribed] …`,
 * `[image] …`, `[document: x.pdf] …` — `contexto.ts`). Com o rótulo, a busca
 * por palavras (que exige TODAS as palavras) nunca acharia nada num áudio.
 */
export function consultaDaUltimaMensagem(conversa: ChatMessage[]): string {
  return latestUserMessage(conversa).replace(/^\[[^\]]*\]\s*/, '').trim()
}

/**
 * Até `k` trechos dos documentos do agente relevantes para `consulta` (a
 * última mensagem do cliente — texto ou transcrição).
 */
export async function retrieveKnowledgeDoAgente(
  db: SupabaseClient,
  accountId: string,
  iaAgenteId: string,
  chaveDeEmbeddings: () => Promise<string | null>,
  consulta: string,
  k = 5,
): Promise<TrechoDaBase[]> {
  const query = consulta.trim()
  if (!query || k <= 0) return []

  // O agente tem algum documento? Sem isso, nada de chave nem de provedor.
  try {
    const { data, error } = await db
      .from('cb_ia_agente_documentos')
      .select('documento_id')
      .eq('account_id', accountId)
      .eq('ia_agente_id', iaAgenteId)
      .limit(1)
    if (error || !data || data.length === 0) return []
  } catch {
    return []
  }

  const escolhidos = new Map<string, TrechoDaBase>()

  let chave: string | null = null
  try {
    chave = await chaveDeEmbeddings()
  } catch (err) {
    console.error('[ia-agentes] leitura da chave de embeddings falhou (segue só por palavras):', err)
  }

  if (chave) {
    try {
      const [vetor] = await embedTexts(chave, [query])
      if (vetor) {
        const { data, error } = await db.rpc('cb_ia_buscar_conhecimento_semantico', {
          p_account_id: accountId,
          p_ia_agente_id: iaAgenteId,
          p_query_embedding: toVectorLiteral(vetor),
          p_match_count: k,
        })
        if (error) console.error('[ia-agentes] busca por sentido falhou:', error.message)
        for (const l of lerLinhas(data)) {
          escolhidos.set(l.id, { id: l.id, documentoId: l.documento_id, content: l.content })
        }
      }
    } catch (err) {
      console.error('[ia-agentes] busca por sentido falhou (segue por palavras):', err)
    }
  }

  // Por palavras: completa a busca por sentido, ou é a única (sem chave).
  if (escolhidos.size < k) {
    try {
      const { data, error } = await db.rpc('cb_ia_buscar_conhecimento_fts', {
        p_account_id: accountId,
        p_ia_agente_id: iaAgenteId,
        p_query: query,
        p_match_count: k,
      })
      if (error) console.error('[ia-agentes] busca por palavras falhou:', error.message)
      for (const l of lerLinhas(data)) {
        if (escolhidos.size >= k) break
        if (!escolhidos.has(l.id)) escolhidos.set(l.id, { id: l.id, documentoId: l.documento_id, content: l.content })
      }
    } catch (err) {
      console.error('[ia-agentes] busca por palavras falhou:', err)
    }
  }

  return [...escolhidos.values()].slice(0, k)
}
