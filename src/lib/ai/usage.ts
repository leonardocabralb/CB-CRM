import type { SupabaseClient } from '@supabase/supabase-js'
import type { AiProvider, AiUsage } from './types'

export interface LogAiUsageArgs {
  accountId: string
  /** Null for a draft not tied to one thread, or when the row was
   *  deleted between generation and logging. */
  conversationId: string | null
  /** 'radar' = análise em lote do Radar de Atendimento (941 ampliou o CHECK).
   *  'agente' / 'agente_teste' = um agente de IA em produção / no Playground
   *  (1043, D13 do docs/PLANO-agentes-de-ia.md). */
  mode: 'auto_reply' | 'draft' | 'radar' | 'transcricao' | 'agente' | 'agente_teste'
  /** Canal por onde a conversa corre — atribui o custo por numero. */
  channelId?: string | null
  provider: AiProvider
  model: string
  /** Provider usage; a no-op when null (nothing worth recording). */
  usage: AiUsage | null
  /** O agente de IA da chamada (1043) e o nome dele CONGELADO — o uso antigo
   *  mantém o nome mesmo que o agente seja renomeado ou arquivado. */
  iaAgenteId?: string | null
  iaAgenteNome?: string | null
}

/**
 * Best-effort append to `ai_usage_log` — one row per LLM call, for cost
 * visibility on the account's BYO key. NEVER throws: usage accounting
 * must not fail a reply the customer is waiting on, so any DB error is
 * logged and swallowed. Skips entirely when the provider didn't report
 * usage (we'd only be writing zeros).
 *
 * Pass the service-role admin client from the webhook, or the RLS-scoped
 * SSR client from a route — writes land either way (there's no
 * `authenticated` INSERT policy, so an SSR write relies on the service
 * role; callers that must persist from a route should pass the admin
 * client).
 */
export async function logAiUsage(
  db: SupabaseClient,
  args: LogAiUsageArgs,
): Promise<void> {
  if (!args.usage) return
  try {
    const { error } = await db.from('ai_usage_log').insert({
      account_id: args.accountId,
      conversation_id: args.conversationId,
      mode: args.mode,
      channel_id: args.channelId ?? null,
      provider: args.provider,
      model: args.model,
      prompt_tokens: args.usage.promptTokens,
      completion_tokens: args.usage.completionTokens,
      total_tokens: args.usage.totalTokens,
      // Só quando há agente: a linha de Radar/transcrição não carrega as colunas
      // (e o app anterior à 1043, sem elas no banco, continua gravando).
      ...(args.iaAgenteId
        ? { ia_agente_id: args.iaAgenteId, ia_agente_nome: args.iaAgenteNome ?? null }
        : {}),
    })
    if (error) {
      console.error('[ai usage] log insert failed:', error)
    }
  } catch (err) {
    console.error('[ai usage] log insert threw:', err)
  }
}
