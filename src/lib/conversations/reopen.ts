import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Devolve à caixa de entrada uma conversa encerrada em que alguém acabou de
 * falar — o cliente OU a equipe (decisão do operador, 2026-09-02).
 *
 * Nasceu no upstream (issue #409) só para o cliente: a ingestão incrementava
 * `unread_count` e deixava `status` em paz, então a conversa encerrada
 * acumulava mensagens não lidas parecendo resolvida, fora do filtro de
 * abertas. Aqui virou a regra que sustenta a caixa de entrada inteira: a aba
 * "Abertas" esconde as encerradas, e isso só é confiável se encerrada
 * significar "não há nada a fazer" — logo QUALQUER mensagem nova (recebida,
 * enviada pelo CRM, pelo celular pareado, agendada, pela API) a reabre.
 *
 * ⚠️ QUATRO caminhos chamam isto, e há teste estrutural cobrando cada um
 * (`reopen.chamadores.test.ts`): a ingestão da Meta (`webhook/route.ts`), a
 * ingestão da Evolution e o celular pareado (`inbound-store.ts`, DUAS
 * funções) e o núcleo de envio (`send-message.ts`). Até 2026-09-02 só o
 * primeiro chamava — e produção roda Evolution: a regra existia e não valia
 * para nenhuma mensagem real.
 *
 * ⚠️ Broadcast, automação, fluxo e resposta de IA NÃO reabrem, de propósito.
 * Ficam de fora por não passarem por nenhum dos quatro caminhos, sem uma
 * linha de guarda — o mesmo desenho do roteador de funil. Um disparo para
 * 500 encerradas devolveria as 500 à caixa de uma vez, e "o robô respondeu"
 * não é gente decidindo retomar um atendimento. Se o cliente responder, a
 * mensagem DELE reabre.
 *
 * `assignTo`: quem reabriu fica RESPONSÁVEL (regra do operador: a conversa
 * reaberta é atribuída a quem a abriu e segue com essa pessoa até ser
 * encerrada de novo — e encerrar solta o responsável, ver `situacao.ts`). Só o
 * envio por gente logada tem quem nomear; o cliente, o celular pareado (sem
 * usuário do CRM por trás) e a API por chave não passam nada, e a atribuição
 * fica como estava — que, depois de um encerramento, é vazia.
 *
 * Mora num módulo próprio para ser testável sem a rota inteira e para todo
 * caminho novo de mensagem ganhar o comportamento chamando uma função só.
 */
export async function reopenClosedConversation(
  db: SupabaseClient,
  conversation: { id: string; status?: string | null },
  opts: { assignTo?: string | null } = {},
): Promise<boolean> {
  // Aberta/pendente é o caso comum — pular a ida ao banco mantém a ingestão
  // tão barata quanto era.
  if (conversation.status !== 'closed') return false

  const patch: Record<string, unknown> = {
    status: 'open',
    updated_at: new Date().toISOString(),
  }
  if (opts.assignTo) patch.assigned_agent_id = opts.assignTo

  const { error } = await db
    .from('conversations')
    .update(patch)
    .eq('id', conversation.id)
    // Conferido de novo em SQL, não só no `if` acima: a linha do chamador foi
    // lida no começo da requisição, e duas entregas concorrentes segurando um
    // `status: 'closed'` velho não podem escrever 'open' por cima de quem
    // acabou de encerrar a conversa de novo no meio delas.
    .eq('status', 'closed')

  if (error) {
    // Best-effort, como a atualização da conversa que precede isto: uma
    // reabertura que falha não pode abortar a ingestão (e fazer a Meta
    // reentregar).
    console.error('Error re-opening conversation:', error)
    return false
  }

  return true
}
