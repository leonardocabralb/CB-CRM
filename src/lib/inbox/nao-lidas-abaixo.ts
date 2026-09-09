// ============================================================
// "N mensagens não lidas" — o botão que aparece quando o operador rolou o
// fio para cima e o cliente escreveu enquanto isso.
//
// A conta é PURA e parte de uma âncora: a última mensagem que estava na tela
// da última vez em que o operador esteve colado no fim (o fio guarda esse id
// no `onScroll`). Tudo que veio DEPOIS dela e é do cliente conta; o que nós
// mesmos mandamos não — o operador sabe o que acabou de enviar, e a bolha
// otimista já rola sozinha para o fim.
// ============================================================

export interface MensagemParaContar {
  id: string;
  sender_type?: string | null;
}

/**
 * Quantas mensagens do CLIENTE chegaram depois da âncora.
 *
 * Âncora nula (o operador ainda não esteve no fim desta conversa) ou âncora
 * que não está na lista (a conversa foi recarregada e aquela mensagem saiu do
 * corte) = 0: melhor calar do que contar a conversa inteira como "não lida".
 */
export function contarNovasDoCliente(
  mensagens: readonly MensagemParaContar[],
  ultimaVistaId: string | null,
): number {
  if (!ultimaVistaId) return 0;
  const i = mensagens.findIndex((m) => m.id === ultimaVistaId);
  if (i < 0) return 0;
  let n = 0;
  for (let j = i + 1; j < mensagens.length; j++) {
    if (mensagens[j].sender_type === 'customer') n++;
  }
  return n;
}
