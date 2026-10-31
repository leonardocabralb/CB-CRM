import type { Notification } from "@/types";
import { DEDUPE_WINDOW_MS, truncateBody } from "./browser-notify";
import { rotaDoAviso } from "./rota-do-aviso";
import type { TextoDoAviso } from "./texto-do-aviso";

// ============================================================
// O aviso do SINO também no navegador (pedido do operador, 20/10/2026;
// `docs/PLANO-avisos-do-sino-no-navegador.md`). Até aqui o pop-up era só de
// mensagem de cliente; menção, tarefa e o resto do sino só somavam o número
// da barra lateral.
//
// Decisões do operador: todo tipo do sino vira pop-up (D2), e nenhum recorte
// das mensagens vale aqui (D3) — "Conexões que avisam", "quais conversas" e
// as conexões do perfil não calam a menção: é alguém chamando a pessoa pelo
// nome, e o sino também não recorta. Só a porta da Caixa de entrada vale,
// porque sem ela não há cartão para desligar o aviso. O texto segue o "Mostrar o texto" (D5); o clique
// leva aonde o sino leva e marca o aviso como lido (D6).
// ============================================================

export type SilencioDoSino =
  | "sem_caixa_de_entrada"
  | "de_outra_pessoa"
  | "ja_lido"
  | "repetido"
  | "conversa_a_vista";

/**
 * O aviso que acabou de entrar no sino vira pop-up? Devolve o motivo do
 * silêncio, ou `null` quando avisa.
 *
 * `vistos` é mutado: o id que passa é registrado (o realtime pode entregar o
 * mesmo INSERT de novo ao reconectar) e os velhos saem. O registro vem ANTES
 * da conferência da tela, como na régua das mensagens: a repetição de um
 * aviso calado continua calada.
 */
export function silencioDoSino(args: {
  aviso: Pick<Notification, "id" | "user_id" | "read_at" | "conversation_id" | "task_id">;
  userId: string;
  /**
   * `podeVerTela(ctx REAL, 'inbox')`. ⚠️ Sem a Caixa de entrada o cartão nem
   * aparece (`profile-form.tsx`): o pop-up chegaria — a chave nasce ligada —
   * sem a pessoa ter onde desligá-lo, e o clique na menção cairia na
   * `TelaBloqueada`. A mesma porta do aviso de mensagem.
   */
  podeVerCaixa: boolean;
  vistos: Map<string, number>;
  /** A conversa aberta na aba VISÍVEL (`/inbox?c=<id>`), ou null. */
  conversaAVista: string | null;
  agoraMs: number;
}): SilencioDoSino | null {
  const { aviso, userId, podeVerCaixa, vistos, conversaAVista, agoraMs } = args;
  if (!podeVerCaixa) return "sem_caixa_de_entrada";
  // A RLS e o filtro do canal já recortam pelo login; conferido de novo
  // porque um pop-up com o aviso de outra pessoa não tem conserto.
  if (aviso.user_id !== userId) return "de_outra_pessoa";
  if (aviso.read_at) return "ja_lido";

  for (const [id, em] of vistos) {
    if (agoraMs - em > DEDUPE_WINDOW_MS) vistos.delete(id);
  }
  if (vistos.has(aviso.id)) return "repetido";
  vistos.set(aviso.id, agoraMs);

  // A anotação já aparece no fio aberto: o pop-up repetiria o que está na
  // tela. O sino continua com o aviso, como hoje. Aviso de tarefa não abre a
  // conversa (`rotaDoAviso`), então não se cala por ela.
  if (!aviso.task_id && aviso.conversation_id && aviso.conversation_id === conversaAVista) {
    return "conversa_a_vista";
  }
  return null;
}

export interface PopUpDoSino {
  titulo: string;
  /** Nulo quando a pessoa escondeu o texto ou o aviso não tem corpo. */
  corpo: string | null;
  /** Um pop-up por aviso, com prefixo próprio: o de mensagem usa o id da conversa. */
  tag: string;
  /** Para onde o clique leva — o mesmo destino do sino; null = só marca lido. */
  rota: string | null;
  /**
   * A conversa que o clique abre, para o sinal da caixa de entrada já
   * montada (`EVENTO_ABRIR_CONVERSA`). Nula no aviso de tarefa, que vai para
   * Tarefas mesmo quando um dia trouxer conversa (a ordem de `rotaDoAviso`).
   */
  conversaId: string | null;
  /**
   * A anotação até onde o fio salta (1114), para o sinal da caixa de entrada
   * já montada (`EVENTO_IR_PARA_NOTA`). Só com `conversaId`: sem conversa
   * aberta não há fio onde saltar.
   */
  notaId: string | null;
}

/**
 * O pop-up de um aviso do sino. `texto` sai de `textoDoAviso` — a conversa
 * atribuída tem o texto no dicionário (o gatilho da 0027 grava em inglês);
 * os avisos nossos já gravam título e corpo prontos.
 */
export function popUpDoSino(
  aviso: Pick<Notification, "id" | "conversation_id" | "task_id" | "note_id">,
  texto: TextoDoAviso,
  mostrarTexto: boolean,
): PopUpDoSino {
  const corpo = mostrarTexto && texto.corpo?.trim() ? truncateBody(texto.corpo) : null;
  const conversaId = aviso.task_id ? null : (aviso.conversation_id ?? null);
  return {
    titulo: texto.titulo,
    corpo,
    tag: `sino:${aviso.id}`,
    rota: rotaDoAviso(aviso),
    conversaId,
    notaId: conversaId ? (aviso.note_id ?? null) : null,
  };
}
