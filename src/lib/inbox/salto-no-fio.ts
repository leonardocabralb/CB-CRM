// ============================================================
// O salto PEDIDO DE FORA do fio (09/09/2026): a aba Notas e a aba Arquivos
// do painel têm um "Ver na conversa" que leva à mensagem (ou anotação) de
// onde aquilo veio. O painel e o fio são irmãos — a página é o único caminho
// entre eles (mesma razão do `termoDaBusca`) —, então o pedido viaja por
// prop, e este módulo é a forma dele.
//
// ⚠️ NÃO reusa o salto da BUSCA (`acharNoFio` + `alvoId`), de propósito:
// aquele é DERIVADO de um termo e fica de pé enquanto a busca existir; este
// é um EVENTO — clicou, rolou, destacou por alguns segundos, acabou. Um
// alvo posto no mesmo estado da busca ficaria destacado até alguém apagar
// a caixa da lista, do outro lado da tela.
// ============================================================

/** O que o painel pede: uma mensagem (`messages.id`) ou uma anotação. */
export interface AlvoDoSalto {
  tipo: "mensagem" | "nota";
  id: string;
}

/**
 * O pedido, já carimbado pela página.
 *
 * `n` cresce a cada clique — sem ele, clicar duas vezes no mesmo anexo
 * seria o MESMO objeto para o React e o segundo clique não rolaria (o
 * operador rolou para longe e quer voltar). `conversationId` é a
 * assinatura: um pedido feito numa conversa não pode ser atendido noutra
 * — sem ele, trocar de conversa antes de o fio carregar deixava um pedido
 * pendente que dispararia ao voltar (mesma família da `escolhaNaBusca`).
 */
export interface PedidoDeSalto extends AlvoDoSalto {
  conversationId: string;
  n: number;
}

export function novoPedidoDeSalto(
  anterior: PedidoDeSalto | null,
  conversationId: string,
  alvo: AlvoDoSalto,
): PedidoDeSalto {
  return { ...alvo, conversationId, n: (anterior?.n ?? 0) + 1 };
}

/**
 * O seletor da âncora no DOM do fio.
 *
 * ⚠️ `data-message-id` é o de `LinhaDoFio` em `message-thread.tsx`, com
 * `messages.id` (NUNCA o wamid `message_id`); `data-nota-id` é a mesma
 * âncora para a anotação intercalada. Há teste cobrando os dois nomes —
 * renomear o atributo lá sem mexer aqui faz o botão não fazer NADA, sem
 * erro nenhum.
 */
export function seletorDoAlvo(alvo: AlvoDoSalto): string {
  const atributo = alvo.tipo === "nota" ? "data-nota-id" : "data-message-id";
  return `[${atributo}="${alvo.id}"]`;
}

/** Quanto tempo o destaque do salto fica aceso depois de centralizar. */
export const DESTAQUE_DO_SALTO_MS = 2500;
