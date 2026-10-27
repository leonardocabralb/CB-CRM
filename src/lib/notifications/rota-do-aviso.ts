import type { Notification } from "@/types";

import { urlDoInbox } from "@/lib/inbox/url";

// ============================================================
// Para onde o clique num aviso leva — a MESMA resposta no sino
// (`notifications/page.tsx`), no card de notificações do Meu dia e no pop-up
// do navegador (`popUpDoSino`).
//
// ⚠️ `task_id` é testado ANTES de `conversation_id` (944): o aviso de tarefa
// nasce sem conversa justamente para não cair no inbox, e na ordem inversa
// qualquer aviso que um dia ganhasse as duas colunas iria para o fio — o
// destino de um aviso de tarefa é a tarefa. `null` = o aviso não leva a lugar
// nenhum (só marca lido).
//
// O aviso de anotação (1114) leva também a ANOTAÇÃO (`&nota=`): o fio abre já
// no trecho que gerou o aviso. Sem `note_id` (aviso anterior à 1114), só a
// conversa, como antes.
// ============================================================

export function rotaDoAviso(
  aviso: Pick<Notification, "task_id" | "conversation_id" | "note_id">,
): string | null {
  if (aviso.task_id) return "/tarefas";
  if (aviso.conversation_id) {
    return urlDoInbox({ c: aviso.conversation_id, nota: aviso.note_id });
  }
  return null;
}
