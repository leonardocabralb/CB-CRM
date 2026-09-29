import type { Notification } from "@/types";

import { urlDoInbox } from "@/lib/inbox/url";

// ============================================================
// Para onde o clique num aviso leva — a MESMA resposta no sino
// (`notifications/page.tsx`) e no card de notificações do Meu dia.
//
// ⚠️ `task_id` é testado ANTES de `conversation_id` (944): o aviso de tarefa
// nasce sem conversa justamente para não cair no inbox, e na ordem inversa
// qualquer aviso que um dia ganhasse as duas colunas iria para o fio — o
// destino de um aviso de tarefa é a tarefa. `null` = o aviso não leva a lugar
// nenhum (só marca lido).
// ============================================================

export function rotaDoAviso(
  aviso: Pick<Notification, "task_id" | "conversation_id">,
): string | null {
  if (aviso.task_id) return "/tarefas";
  if (aviso.conversation_id) return urlDoInbox({ c: aviso.conversation_id });
  return null;
}
