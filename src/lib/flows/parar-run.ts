import type { SupabaseClient } from '@supabase/supabase-js'

// ------------------------------------------------------------
// Encerrar a run ativa de um contato.
//
// ⚠️ **Mora num arquivo próprio, e não em `engine.ts`, por causa de um ciclo
// de import.** O grafo real é:
//
//     flows/engine → contacts/tag-events → automations/engine
//
// Se o motor de automações importasse `flows/engine` para parar um robô, o
// ciclo se fecharia. (O `automations/engine` já desvia disto de propósito ao
// importar `tag-write` em vez de `tag-events`.) Aqui não há dependência
// nenhuma além do tipo do cliente, então as três pontas — envio humano,
// `stop_flow` e `run_flow` — importam estaticamente sem risco.
//
// A outra metade do controle externo (`startFlowForContact`) precisa do laço
// de avanço e continua em `engine.ts`, importada DINAMICAMENTE pelo passo que
// a usa.
// ------------------------------------------------------------

/**
 * Por que a run terminou. O status é grosso; o `end_reason` é o fino.
 *
 * ⚠️ Os dois valores contam histórias diferentes e apagar essa diferença
 * estraga a investigação: `paused_by_agent` quer dizer "uma PESSOA entrou na
 * conversa" — o sinal mais forte de "sai da frente, tem gente aqui" —, e
 * `stopped_by_automation` quer dizer "uma REGRA mandou parar". Quem for
 * entender por que o robô calou precisa saber qual dos dois foi.
 *
 * Ambos aceitos pelo CHECK de `flow_runs.status` desde a migration 936.
 */
export type MotivoDeParada = 'paused_by_agent' | 'stopped_by_automation'

/**
 * Encerra a run ativa do contato, se houver. Devolve quantas encerrou.
 *
 * ⚠️ **Nunca lança.** As três pontas que chamam são melhor-esforço, e uma
 * delas é o envio de mensagem por um humano — onde o bloco roda DEPOIS de a
 * mensagem já ter saído para o WhatsApp. Estourar ali faria o cliente receber
 * a mensagem e o operador ver um erro.
 */
export async function abortActiveRunsForContact(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  status: MotivoDeParada
  reason: string
}): Promise<number> {
  try {
    const { data, error } = await args.db
      .from('flow_runs')
      .update({
        status: args.status,
        ended_at: new Date().toISOString(),
        end_reason: args.reason,
      })
      .eq('account_id', args.accountId)
      .eq('contact_id', args.contactId)
      .eq('status', 'active')
      .select('id')
    if (error) {
      console.error('[flows] abortActiveRunsForContact failed:', error.message)
      return 0
    }
    return (data ?? []).length
  } catch (err) {
    console.error(
      '[flows] abortActiveRunsForContact threw:',
      err instanceof Error ? err.message : err,
    )
    return 0
  }
}
