// ============================================================
// O que o quadro de funis sabe sobre a CONVERSA de cada card.
//
// ⚠️ POR QUE UM SELECT PRÓPRIO, E NÃO O `CONVERSATION_SELECT` DO INBOX
// Aquele select é contrato da API pública v1 (ver o comentário em
// `conversation-list.tsx`) — estendê-lo mudaria a resposta de `/api/v1`.
// Este aqui é só do quadro: embute, via contato, a conversa (não lidas +
// última mensagem) e as etiquetas.
//
// ⚠️ SEM REALTIME, DE PROPÓSITO. `deals` e `contact_tags` não estão na
// publication, e o gesto que importa — voltar do inbox para o funil —
// REMONTA a página e refaz o fetch: o dado se corrige exatamente quando o
// operador volta a olhar para ele. Uma assinatura aqui seria infra nova
// para encurtar uma janela que o próprio fluxo já fecha.
// ============================================================

import type { Contact, Deal, Tag } from "@/types";

/** As quatro colunas da conversa que o card exibe. */
export interface ResumoDaConversa {
  id: string;
  unread_count: number;
  last_message_text: string | null;
  last_message_at: string | null;
}

/**
 * `conversations` sem alias: o PostgREST resolve o embed reverso pela FK
 * `conversations.contact_id`. A UNIQUE da 036 (`account_id, contact_id`)
 * garante no máximo uma linha por contato — mas o índice é COMPOSTO, então
 * não dá para prever se a resposta vem como array ou objeto;
 * {@link normalizarDealDoQuadro} aceita os dois.
 */
export const DEAL_SELECT_DO_QUADRO =
  "*, contact:contacts(*, contact_tags(tags(*)), conversations(id, unread_count, last_message_text, last_message_at)), assignee:profiles!deals_assigned_to_fkey(*)";

/** O select de antes do embed novo — é o plano B quando o PostgREST recusa. */
export const DEAL_SELECT_BASICO =
  "*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)";

/** Forma crua devolvida por {@link DEAL_SELECT_DO_QUADRO}, antes do achatamento. */
type RawContactDoQuadro = Contact & {
  contact_tags?: { tags: Tag | null }[] | null;
  conversations?: ResumoDaConversa[] | ResumoDaConversa | null;
};
export type RawDealDoQuadro = Omit<Deal, "contact"> & {
  contact?: RawContactDoQuadro | null;
};

export type DealDoQuadro = Deal & {
  /** A conversa do CONTATO (única pela 036), ou null. */
  conversa: ResumoDaConversa | null;
};

/**
 * Entre as conversas embutidas, qual representa o card. Mais de uma linha só
 * acontece em sobra que a 036 não pegou — aí vale a que casa com o vínculo
 * gravado no negócio; sem casar, a de conversa mais recente.
 *
 * A comparação de `last_message_at` é lexicográfica: o PostgREST serializa
 * todos os timestamps da mesma resposta no mesmo formato ISO.
 */
function escolherConversa(
  lista: ResumoDaConversa[],
  conversationId: string | null,
): ResumoDaConversa | null {
  if (lista.length === 0) return null;
  if (conversationId) {
    const casada = lista.find((c) => c.id === conversationId);
    if (casada) return casada;
  }
  return lista.reduce((melhor, c) => {
    if (!melhor.last_message_at) return c.last_message_at ? c : melhor;
    if (!c.last_message_at) return melhor;
    return c.last_message_at > melhor.last_message_at ? c : melhor;
  });
}

/**
 * Achata o embed em `contact.tags` (mesma regra do `normalizeConversation`
 * do inbox) e resolve `conversa`. Linha sem contato passa limpa — negócio
 * de contato apagado continua no quadro.
 */
export function normalizarDealDoQuadro(raw: RawDealDoQuadro): DealDoQuadro {
  const rawContact = raw.contact;
  if (!rawContact) return { ...(raw as Deal), contact: undefined, conversa: null };

  const { contact_tags, conversations, ...contact } = rawContact;
  const lista = Array.isArray(conversations)
    ? conversations
    : conversations
      ? [conversations]
      : [];

  return {
    ...(raw as Deal),
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
    conversa: escolherConversa(lista, raw.conversation_id ?? null),
  };
}

/**
 * A conversa que o card ABRE, e o resumo que ele pode EXIBIR.
 *
 * Precedência idêntica à do link no `deal-form.tsx`: o vínculo gravado
 * (`deals.conversation_id`, 910) vence — é histórico e sobrevive a contato
 * apagado; a conversa embutida do contato cobre negócio anterior à 910.
 *
 * ⚠️ Se o vínculo gravado divergir da conversa embutida (contato trocado no
 * negócio, sobra pré-036), `resumo` volta null: pintar a prévia de UMA
 * conversa e abrir OUTRA é mentira silenciosa. Pós-036 as duas concordam.
 */
export function conversaDoCard(
  deal: DealDoQuadro,
): { id: string; resumo: ResumoDaConversa | null } | null {
  if (deal.conversation_id) {
    const resumo =
      deal.conversa && deal.conversa.id === deal.conversation_id
        ? deal.conversa
        : null;
    return { id: deal.conversation_id, resumo };
  }
  if (deal.conversa) return { id: deal.conversa.id, resumo: deal.conversa };
  return null;
}

/**
 * O que o clique no corpo do card faz. Sem conversa nenhuma (negócio sem
 * contato, ou contato que nunca conversou) o clique cai no formulário de
 * edição — o comportamento de sempre; mandar para o inbox genérico seria um
 * beco sem saída atrás de uma conversa que não existe.
 */
export function destinoDoCard(
  deal: DealDoQuadro,
): { tipo: "conversa"; conversationId: string } | { tipo: "formulario" } {
  const conversa = conversaDoCard(deal);
  return conversa
    ? { tipo: "conversa", conversationId: conversa.id }
    : { tipo: "formulario" };
}
