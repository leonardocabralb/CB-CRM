import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A PRIMEIRA mensagem do cliente na conversa, decidida UMA vez (1105).
 *
 * É ela que acende o gatilho "Primeira mensagem recebida" das automações
 * (`first_inbound_message`) e a entrada de robô por primeira mensagem
 * (`isFirstInboundMessage` de `dispatchInboundToFlows`). Os dois caminhos de
 * cliente do WhatsApp — o webhook da Meta e o `persistInboundMessage` da
 * Evolution — contam as mensagens anteriores do cliente ANTES de gravar a
 * nova, e liam "zero" como "é a primeira". Numa rajada (o cliente manda "oi"
 * e "tudo bem?" no mesmo segundo, cada uma na sua requisição), as duas contam
 * antes de qualquer uma gravar, as duas veem zero, e a saudação chegava em
 * DOBRO ao cliente. Porte adaptado do #675 do original.
 *
 * Agora a contagem só diz se VALE TENTAR. Depois do INSERT da mensagem, a
 * conversa é reivindicada por um UPDATE condicional
 * (`first_inbound_at IS NULL` no WHERE): sob READ COMMITTED, a segunda
 * requisição espera a trava da linha, relê a versão nova e volta com zero
 * linhas. Quem decide é o banco, nunca o que cada requisição contou.
 *
 * Diferenças do original, de propósito:
 *  - SEM preencher as conversas antigas (a 054 dele preenche todas a partir
 *    de `messages`): a coluna nasce nula e só é escrita aqui. Por isso
 *    `first_inbound_at` nulo quer dizer "ninguém reivindicou", nunca "o
 *    cliente nunca escreveu".
 *  - A contagem CONTINUA antes do insert (o original a tirou): sem ela, a
 *    conversa antiga — coluna nula, cliente de anos — seria reivindicada pela
 *    próxima mensagem dele e receberia a saudação de quem chega.
 *
 * ⚠️ Falha FECHADA nas duas pontas: a contagem que falhou e a reivindicação
 * que falhou (ou lançou) devolvem `false`, com log. Perder uma saudação é o
 * lado seguro; mandá-la em dobro, ou a um cliente antigo, não. Nunca lança.
 */

/** O que a contagem de mensagens anteriores do cliente (feita ANTES do insert) respondeu. */
export interface ContagemAnterior {
  count: number | null
  error: { message: string } | null
}

/**
 * `true` só para a mensagem que levou a reivindicação. Chamar DEPOIS do
 * INSERT da mensagem ter dado certo (na Meta, depois do `return` da
 * reentrega) e ANTES do robô e das automações, que leem a resposta.
 */
export async function reivindicarPrimeiraMensagem(
  db: SupabaseClient,
  conversationId: string,
  contagem: ContagemAnterior,
  agora: Date = new Date(),
): Promise<boolean> {
  if (contagem.error) {
    console.error(
      '[primeira-mensagem] a contagem das mensagens anteriores falhou; não é a primeira:',
      contagem.error.message,
    )
    return false
  }
  // `head` com `count: 'exact'` sempre traz o número quando não há erro; o
  // nulo vale zero, como sempre valeu.
  if ((contagem.count ?? 0) > 0) return false

  try {
    const { data, error } = await db
      .from('conversations')
      .update({ first_inbound_at: agora.toISOString() })
      .eq('id', conversationId)
      .is('first_inbound_at', null)
      .select('id')
    if (error) {
      console.error(
        '[primeira-mensagem] a reivindicação falhou; não é a primeira:',
        error.message,
      )
      return false
    }
    return (data?.length ?? 0) > 0
  } catch (err) {
    console.error(
      '[primeira-mensagem] a reivindicação lançou; não é a primeira:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}
