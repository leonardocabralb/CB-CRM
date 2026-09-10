// ============================================================
// "N mensagens não lidas" — o botão que aparece quando o operador rolou o
// fio para cima e o cliente escreveu enquanto isso.
//
// A conta é PURA e parte de uma âncora: a última mensagem que estava na tela
// da última vez em que o operador esteve colado no fim (o fio guarda id e
// `created_at` dela no `onScroll`). Tudo que veio DEPOIS dela e é do cliente
// conta; o que nós mesmos mandamos não — o operador sabe o que acabou de
// enviar, e a bolha otimista já rola sozinha para o fim.
// ============================================================

export interface MensagemParaContar {
  id: string;
  sender_type?: string | null;
  /** Aviso de sistema do grupo ("Fulano entrou") vem como `customer` + `system`. */
  content_type?: string | null;
  created_at?: string | null;
}

export interface AncoraDaLeitura {
  id: string | null;
  createdAt: string | null;
}

/** Mensagem que conta como "o cliente escreveu": do cliente, e não aviso do sistema. */
function escritaPeloCliente(m: MensagemParaContar): boolean {
  return m.sender_type === 'customer' && m.content_type !== 'system';
}

/**
 * Quantas mensagens do CLIENTE chegaram depois da âncora.
 *
 * Procura a âncora pelo `id`; quando o id não está mais na lista, cai para o
 * `created_at` dela. ⚠️ O segundo caminho existe por causa da bolha OTIMISTA:
 * o operador envia, o fio rola ao fim e a âncora vira o `temp-…` da otimista;
 * o realtime então troca a linha pela gravada, com OUTRO id, sem novo evento
 * de rolagem (a altura não muda) — e a âncora ficava órfã para sempre, o
 * botão nunca mais acendia até o operador voltar ao fim (Codex, PR #179).
 * Pelo tempo, a linha gravada e as que vierem depois continuam contando.
 *
 * Sem id nem `created_at` (o operador ainda não esteve no fim desta
 * conversa) = 0: melhor calar do que contar a conversa inteira como "não lida".
 */
export function contarNovasDoCliente(
  mensagens: readonly MensagemParaContar[],
  ancora: AncoraDaLeitura,
): number {
  const i = ancora.id ? mensagens.findIndex((m) => m.id === ancora.id) : -1;
  if (i >= 0) {
    let n = 0;
    for (let j = i + 1; j < mensagens.length; j++) {
      if (escritaPeloCliente(mensagens[j])) n++;
    }
    return n;
  }
  if (!ancora.createdAt) return 0;
  const corte = ancora.createdAt;
  let n = 0;
  for (const m of mensagens) {
    if (m.created_at && m.created_at > corte && escritaPeloCliente(m)) n++;
  }
  return n;
}
