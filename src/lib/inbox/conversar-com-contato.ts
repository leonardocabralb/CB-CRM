// ============================================================
// "Conversar" no cartão de contato (1060): abre a "Nova conversa" com o
// número do cartão já preenchido.
//
// Evento global, e não callback, pelo mesmo motivo de `execucoes/aviso.ts`:
// o botão mora na bolha (dentro do fio) e o diálogo mora na lista de
// conversas — irmãos na página do inbox. Fiar um callback page → thread →
// bubble só para isto seria mais caro e mais frágil que um nome de evento.
//
// ⚠️ Uma constante só: a string repetida em dois arquivos faria o botão
// gritar num canal que ninguém ouve — sem erro, sem log, e o clique sem efeito.
// ============================================================

export const EVENTO_CONVERSAR_COM_CONTATO = "cb:conversar-com-contato";

/** O que o cartão entrega ao diálogo. */
export interface PedidoDeConversa {
  /** `+` e o id de WhatsApp do número (ver `numeroParaConversar`). */
  telefone: string;
  nome: string | null;
}

/** Pede à lista de conversas que abra a "Nova conversa" com este número. */
export function pedirConversaComContato(pedido: PedidoDeConversa): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<PedidoDeConversa>(EVENTO_CONVERSAR_COM_CONTATO, { detail: pedido }),
  );
}

/** Lê o `detail` do evento campo a campo (vem de `window`, qualquer um dispara). */
export function lerPedidoDeConversa(evento: Event): PedidoDeConversa | null {
  const detalhe = (evento as CustomEvent<unknown>).detail;
  if (!detalhe || typeof detalhe !== "object") return null;
  const { telefone, nome } = detalhe as Record<string, unknown>;
  if (typeof telefone !== "string" || !telefone.trim()) return null;
  return { telefone: telefone.trim(), nome: typeof nome === "string" && nome.trim() ? nome.trim() : null };
}
