import type { ConversationStatus } from '@/types'

/**
 * O que gravar quando a EQUIPE troca a situação no cabeçalho do fio.
 *
 * Regra do operador (2026-09-02): quem reabre uma conversa encerrada fica
 * responsável por ela, e a atribuição dura até o próximo encerramento —
 * encerrar SOLTA o responsável. É o que faz a reabertura pelo CLIENTE nascer
 * sem dono (ninguém da equipe a abriu) e a reabertura por alguém nascer com
 * essa pessoa. Trocar entre aberta e pendente não mexe em atribuição: não é
 * reabertura.
 *
 * Puro, para o teste. O mesmo par de regras vale no servidor:
 * `reopenClosedConversation` atribui a quem enviou, e o passo
 * `close_conversation` da automação solta o responsável.
 */
export function patchDeSituacao(
  anterior: ConversationStatus,
  nova: ConversationStatus,
  quem: string,
): { status: ConversationStatus; assigned_agent_id?: string | null } {
  if (nova === 'closed') return { status: nova, assigned_agent_id: null }
  if (anterior === 'closed') return { status: nova, assigned_agent_id: quem }
  return { status: nova }
}
