// ============================================================
// "Atribuir a" do bloco "Transferir para atendente" (handoff) do robô — item
// 2.7 do plano do previdenciário (CB, 26/09/2026).
//
// O motor sempre aceitou `assign_to` (o `user_id` de LOGIN do membro —
// `profiles.user_id`, NUNCA `profiles.id`); a tela ganhou o seletor agora. Em
// branco, a conversa fica "pendente" sem responsável, que é como o robô do
// previdenciário nasce (A7: "por ora NÃO atribuir").
//
// ⚠️⚠️ O motor CONFERE que o escolhido é membro DESTA conta na hora da
// transferência, e não só a ativação: quem saiu da conta depois de o robô ser
// ativado continuaria recebendo conversa. `conversations.assigned_agent_id`
// NÃO tem chave estrangeira (medido em 26/09/2026), então o banco aceita
// qualquer UUID; e o gatilho da 027 grava o aviso `conversation_assigned`
// para o escolhido — com o NOME do cliente no título — numa conta que não é
// mais a dele. Id que não existe em `auth.users` é pior: a FK de
// `notifications.user_id` derruba o UPDATE inteiro, e a conversa nem vira
// "pendente".
//
// Leitura que FALHA não atribui (o lado seguro: a conversa cai na fila "sem
// responsável", que alguém olha) e o evento do run diz por quê.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O membro escolhido no nó, ou `null` ("ninguém"). Lido do JSONB, aparado. */
export function membroEscolhidoNoHandoff(config: unknown): string | null {
  const v = (config as { assign_to?: unknown } | null)?.assign_to;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export type AtribuicaoDoHandoff =
  | { userId: string }
  | { userId: null; motivo: 'nao_membro' | 'leitura_falhou' };

/**
 * I/O: o escolhido ainda é membro da conta do robô? Devolve quem atribuir, ou
 * `null` com o motivo. Id sem forma de UUID nem vai à consulta: o Postgres o
 * recusaria (22P02) e o motivo sairia "leitura falhou" sobre um valor que
 * simplesmente não é de ninguém.
 */
export async function atribuicaoDoHandoff(
  db: SupabaseClient,
  accountId: string,
  escolhido: string,
): Promise<AtribuicaoDoHandoff> {
  if (!FORMA_DE_UUID.test(escolhido)) return { userId: null, motivo: 'nao_membro' };
  try {
    const { data, error } = await db
      .from('profiles')
      .select('user_id')
      .eq('account_id', accountId)
      .eq('user_id', escolhido)
      // 1067: suspenso conta como fora da equipe — a conversa fica na fila.
      .is('suspenso_em', null)
      .limit(1);
    if (error) return { userId: null, motivo: 'leitura_falhou' };
    return Array.isArray(data) && data.length > 0
      ? { userId: escolhido }
      : { userId: null, motivo: 'nao_membro' };
  } catch {
    return { userId: null, motivo: 'leitura_falhou' };
  }
}
