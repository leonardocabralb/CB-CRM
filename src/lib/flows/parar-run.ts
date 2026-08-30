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
 *
 * `stopped_by_agent` (955) é a terceira história: uma PESSOA **decidiu**
 * parar, pelo botão da aba Automações da conversa. Não confundir com
 * `paused_by_agent`, que é a parada IMPLÍCITA de alguém respondendo — o
 * botão é intenção declarada, e a investigação trata as duas diferente.
 */
export type MotivoDeParada =
  | 'paused_by_agent'
  | 'stopped_by_automation'
  | 'stopped_by_agent'

interface ArgsDeParada {
  db: SupabaseClient
  accountId: string
  contactId: string
  status: MotivoDeParada
  reason: string
}

/**
 * Encerra a run ativa do contato e DIZ se a escrita falhou.
 *
 * Existe separada de `abortActiveRunsForContact` por causa da rota
 * `parar-robo` (955): ali quem clica é gente esperando confirmação, e
 * traduzir falha de banco em "0 paradas" faria a tela dizer "o robô já
 * tinha terminado" com o robô VIVO, ainda falando com o cliente (achado da
 * revisão do Codex no PR #70). Não lança — devolve o erro por valor; quem
 * é melhor-esforço usa o wrapper abaixo.
 */
export async function encerrarRunsAtivas(
  args: ArgsDeParada,
): Promise<{ ok: true; paradas: number } | { ok: false; erro: string }> {
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
    if (error) return { ok: false, erro: error.message }
    return { ok: true, paradas: (data ?? []).length }
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Encerra a run ativa do contato, se houver. Devolve quantas encerrou.
 *
 * ⚠️ **Nunca lança, e erro vira 0.** As três pontas do MOTOR que chamam são
 * melhor-esforço, e uma delas é o envio de mensagem por um humano — onde o
 * bloco roda DEPOIS de a mensagem já ter saído para o WhatsApp. Estourar ali
 * faria o cliente receber a mensagem e o operador ver um erro. Ação de TELA
 * que precisa distinguir "nada ativo" de "banco falhou" usa
 * `encerrarRunsAtivas`.
 */
export async function abortActiveRunsForContact(
  args: ArgsDeParada,
): Promise<number> {
  const r = await encerrarRunsAtivas(args)
  if (!r.ok) {
    console.error('[flows] abortActiveRunsForContact failed:', r.erro)
    return 0
  }
  return r.paradas
}
