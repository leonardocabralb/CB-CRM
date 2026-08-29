import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  /** Migration 946. NULL = herda `model`. Só o Radar lê. */
  radar_model: string | null
  api_key: string
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

// ⚠️ Colunas nomeadas, não `*`: uma coluna sem GRANT derrubaria a
// consulta inteira. Acrescentar aqui exige que a migration correspondente
// JÁ esteja aplicada em produção — o caminho do agente padrão faz
// `throw` no erro, então uma coluna ausente derruba rascunho,
// auto-reply, Radar e transcrição de uma vez.
const CONFIG_COLUMNS =
  'provider, model, radar_model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean; channelId?: string | null } = {},
): Promise<AiConfig | null> {
  const { requireActive = true, channelId = null } = opts

  // Multi-canal: agente POR canal, com queda para o agente padrao da conta.
  // Antes existia UM unico agente por conta (ai_configs.account_id era
  // UNIQUE), entao o bot se apresentava com o discurso comercial respondendo
  // quem escreveu no numero do juridico. A 903 trocou o UNIQUE por dois
  // indices parciais: um agente padrao (channel_id NULL) + um por canal.
  if (channelId) {
    const { data: doCanal, error: erroCanal } = await db
      .from('ai_configs')
      .select(CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .eq('channel_id', channelId)
      .maybeSingle()
    // Erro (deploy pre-903, coluna ausente) nao pode derrubar a IA — cai no
    // agente padrao, que e o comportamento de antes.
    if (!erroCanal && doCanal) {
      const rowCanal = doCanal as AiConfigRow
      if (!requireActive || rowCanal.is_active) return mapAiConfigRow(rowCanal, accountId)
      // Agente do canal existe mas esta desligado => a IA fica MUDA neste
      // numero. Cair no padrao aqui reabriria o que o operador desligou.
      return null
    }
  }

  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .is('channel_id', null)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !(data as AiConfigRow).is_active) return null

  return mapAiConfigRow(data as AiConfigRow, accountId)
}

/**
 * Linha -> AiConfig. Extraido para que o agente POR CANAL e o agente PADRAO
 * compartilhem exatamente o mesmo mapeamento (incl. o tratamento de chave de
 * embeddings corrompida), em vez de duas copias que podem divergir.
 *
 * Devolve null quando a linha nao e utilizavel (sem api_key).
 */
function mapAiConfigRow(row: AiConfigRow, accountId: string): AiConfig | null {
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // rather than letting decrypt() throw on null.
  if (!row.api_key) return null

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    radarModel: row.radar_model ?? null,
    apiKey: decrypt(row.api_key),
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  // ⚠️ `.is('channel_id', null)` é obrigatório desde a 903: `ai_configs`
  // deixou de ter UNIQUE por conta (virou um par de índices parciais —
  // agente padrão + um por canal), então filtrar só por `account_id` faz
  // o `.maybeSingle()` ESTOURAR na conta que tem agente de canal. O erro
  // era engolido logo abaixo e a base de conhecimento passava a indexar
  // só lexical, em silêncio. A chave de embeddings é uma por conta e
  // mora no agente padrão.
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .is('channel_id', null)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
