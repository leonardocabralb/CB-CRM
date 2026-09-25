import type { SupabaseClient } from '@supabase/supabase-js'
import { lerChave } from '@/lib/ia-chaves/repo'
import { AiError, type AiConfig } from './types'

interface AiConfigRow {
  provider: 'openai' | 'anthropic' | 'gemini'
  model: string
  /** Migration 946. NULL = herda `model`. Só o Radar lê. */
  radar_model: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
}

// ⚠️ Colunas nomeadas, não `*`: uma coluna sem GRANT derrubaria a
// consulta inteira. Acrescentar aqui exige que a migration correspondente
// JÁ esteja aplicada em produção — o caminho do agente padrão faz
// `throw` no erro, então uma coluna ausente derruba rascunho,
// auto-reply e Radar de uma vez.
//
// ⚠️ A CHAVE não é lida daqui desde a 1042: ela mora em `cb_ia_chaves`, uma
// por PROVEDOR para a conta inteira (D1 do docs/PLANO-agentes-de-ia.md).
// `ai_configs.api_key` e `embeddings_api_key` ficam só para o app anterior
// poder voltar atrás; nada novo lê nem grava essas colunas.
const CONFIG_COLUMNS =
  'provider, model, radar_model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id'

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row, no key for its
 * provider, or the master switch (`is_active`) is off — all mean "AI is
 * not available", which callers treat identically.
 *
 * Works with any client for the `ai_configs` row (RLS-scoped SSR client
 * from a dashboard route, or the service-role client from the webhook);
 * the KEY is always read with the service role, because `cb_ia_chaves`
 * is closed to the browser session. The account id comes from a caller
 * that already authenticated it.
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
  // ⚠️ Só o assistente de conversa passa `channelId`. O Radar e a
  // transcrição NÃO resolvem mais pelo canal (1042): a configuração deles é
  // do módulo, da conta inteira.
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
 * Linha -> AiConfig, com a chave do PROVEDOR da linha (`cb_ia_chaves`).
 * Extraido para que o agente POR CANAL e o agente PADRAO compartilhem
 * exatamente o mesmo mapeamento, em vez de duas copias que podem divergir.
 *
 * Devolve null quando a conta NÃO TEM chave para o provedor. ⚠️ Chave que
 * existe e não decifra LANÇA `key_decrypt_failed`, e falha de leitura do banco
 * lança como veio: "não sei" e "não decifra" não podem virar "não configurado"
 * (o rascunho diria "configure o assistente" sobre uma chave cadastrada, e o
 * Radar gravaria `sem_ia` em vez de falhar e tentar de novo).
 */
async function mapAiConfigRow(row: AiConfigRow, accountId: string): Promise<AiConfig | null> {
  const [doChat, deEmbeddings] = await Promise.all([
    lerChave(accountId, row.provider),
    // A chave de embeddings é a da OpenAI da conta, seja qual for o provedor
    // do chat (o modelo de embeddings é fixo, `vector(1536)`). Ilegível,
    // ausente ou com a LEITURA falhando rebaixa a base para a busca por
    // palavras — nunca derruba o rascunho, a resposta automática nem o Radar.
    row.provider === 'openai'
      ? null
      : lerChave(accountId, 'openai').catch((err) => {
          console.error('[ai config] leitura da chave de embeddings falhou:', err)
          return { chave: null, ilegivel: false }
        }),
  ])
  if (doChat.ilegivel) {
    throw new AiError('Stored API key could not be decrypted.', {
      code: 'key_decrypt_failed',
      status: 400,
    })
  }
  if (!doChat.chave) return null
  const embeddingsApiKey =
    row.provider === 'openai' ? doChat.chave : (deEmbeddings?.chave ?? null)

  return {
    provider: row.provider,
    model: row.model,
    radarModel: row.radar_model ?? null,
    apiKey: doChat.chave,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
  }
}

/**
 * A chave de embeddings (a da OpenAI da conta), independente de
 * `is_active`. Usada pelas rotas que indexam a base de conhecimento, para
 * a base ser indexada (e a busca por sentido funcionar) sempre que houver
 * a chave, mesmo com o assistente desligado.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success. Falha de LEITURA também vira "sem
 * chave" aqui (com log): a indexação cai na busca por palavras, como antes.
 */
export async function loadEmbeddingsKey(
  _db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  try {
    const { chave, ilegivel } = await lerChave(accountId, 'openai')
    return { key: chave, corrupt: ilegivel }
  } catch (err) {
    console.error('[ai config] leitura da chave de embeddings falhou:', err)
    return { key: null, corrupt: false }
  }
}
