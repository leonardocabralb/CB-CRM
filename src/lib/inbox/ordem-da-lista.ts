// ============================================================
// Ordem da caixa de entrada entre uma carga e outra.
//
// A lista chega ORDENADA do banco (`last_message_at` decrescente, nulos no
// fim, desempate por `id`), e daí em diante o tempo real só PATCHEAVA as
// linhas no lugar: a conversa que recebia mensagem nova atualizava a hora e a
// prévia, mas ficava onde estava. Medido em 23/09/2026 (relato do operador):
// a conversa de teste recebeu mensagem e continuou na 3ª posição, abaixo de
// uma de 12 minutos atrás — e, reaberta pela mensagem depois de encerrada,
// apareceu na aba "Abertas" no lugar da carga, abaixo da dobra. Parecia que a
// mensagem não tinha chegado; a busca a achava (é a única linha) e recarregar
// a página "resolvia" (a carga reordena). Mudar de aba do navegador também
// resolvia, pelo `visibilitychange`, e é por isso que passou despercebido.
//
// O que muda junto, por escrito (revisão por duas lentes):
// · Conversa NOVA deixa de ir para o topo ao nascer: ela nasce sem
//   `last_message_at` e fica no FIM, como no banco, até o INSERT da primeira
//   mensagem — normalmente dezenas de ms; até ~5 s quando a ingestão espera a
//   entrega do `conversation.created` a um webhook lento. Antes ia para o
//   topo pelo `[conv, ...prev]` da página, e com ela o grupo sincronizado sem
//   mensagem, que a nota do `nullsFirst: false` quer no fim.
// · A garantia "só avança" é do INSERT da mensagem (`comMensagemNova`). O
//   UPDATE da conversa espalha a linha do BANCO inteira, e os gatilhos da
//   ingestão (espera da 972, janela da 993, a reabertura) chegam com a hora
//   ANTIGA antes do bump: a linha pode piscar de volta à posição antiga por
//   um quadro. Converge no bump. Travar o UPDATE também prenderia no topo um
//   carimbo do futuro (relógio adiantado) até recarregar.
// · A lista se move sob o ponteiro, como no WhatsApp: quem mira uma linha
//   pode abrir a de cima se chegar mensagem abaixo dela.
// ============================================================

import type { Conversation, Message } from "@/types";
import { PREVIA_DA_LIGACAO } from "@/lib/whatsapp/ligacoes/previa";

type Ordenavel = Pick<Conversation, "id" | "last_message_at">;

/** Instante em ms, ou `null` para ausente/ilegível (vai para o fim, como no banco). */
function instante(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A MESMA ordem da consulta da lista (`conversation-list.tsx`):
 * `.order("last_message_at", { ascending: false, nullsFirst: false })
 *  .order("id", { ascending: true })`. Mudou um lado, muda o outro — senão a
 * lista pula de ordem ao recarregar.
 *
 * Devolve CÓPIA; a entrada não é tocada (é estado do React).
 */
export function ordenarComoOBanco<T extends Ordenavel>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => {
    const ta = instante(a.last_message_at);
    const tb = instante(b.last_message_at);
    if (ta !== tb) {
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * A linha da lista depois de chegar `mensagem` pelo tempo real.
 *
 * ⚠️ Aviso de SISTEMA do grupo ("Fulano entrou") não mexe na linha: o banco
 * não sobe o grupo nem soma não lida por ele (`cb-groups/system-events.ts`,
 * de propósito — grupo grande tem gente entrando o dia todo), e nenhum
 * UPDATE da conversa viria corrigir a tela. É a régua de
 * `nao-lidas-abaixo.ts`.
 *
 * ⚠️ Hora e prévia só AVANÇAM. Com a lista reordenando, uma mensagem com
 * carimbo antigo — a histórica da 1010, a carga do histórico da 1033, o lote
 * que a Evolution drena fora de ordem — puxaria a conversa para baixo e
 * poria na prévia uma mensagem que não é a última. O banco não recua
 * `last_message_at` nesses casos, então a tela também não.
 *
 * `aberta`: é a conversa que a pessoa está lendo agora — a não lida fica em
 * zero (a página zera no banco logo em seguida).
 */
export function comMensagemNova<C extends Conversation>(
  conversa: C,
  mensagem: Pick<Message, "created_at" | "content_text"> & Partial<Pick<Message, "content_type">>,
  aberta: boolean,
): C {
  if (mensagem.content_type === "system") return conversa;
  const atual = instante(conversa.last_message_at);
  const nova = instante(mensagem.created_at);
  const avanca = atual === null || (nova !== null && nova >= atual);
  return {
    ...conversa,
    ...(avanca
      ? {
          // A ligação (1044) não tem texto: o marcador é o que o banco grava
          // na prévia, e a lista o troca pela frase.
          last_message_text:
            mensagem.content_text ??
            (mensagem.content_type === "call" ? PREVIA_DA_LIGACAO : ""),
          last_message_at: mensagem.created_at,
        }
      : {}),
    unread_count: aberta ? 0 : conversa.unread_count + 1,
  };
}
