// ============================================================
// Resposta a uma anotação interna (1075).
//
// A resposta é uma anotação comum com `resposta_de` apontando a que ela
// responde — que pode ser, ela mesma, uma resposta (como no WhatsApp, a
// citação é do que foi tocado). A CONVERSA sobre uma anotação é tudo o que
// chega à mesma anotação de origem subindo por `resposta_de`.
//
// Decisão do operador (01/10/2026): o aviso vai ao autor de quem foi
// respondida e a todos que já escreveram nessa conversa (a origem e as
// respostas); quem está respondendo, nunca.
// ============================================================

export interface NotaDaConversa {
  id: string;
  resposta_de: string | null;
  author_user_id: string | null;
}

/**
 * Sobe por `resposta_de` até a anotação de origem. Original apagada (o
 * `SET NULL` da 1075) ou fora da lista corta a subida ali: a resposta passa a
 * ser a origem da própria conversa. `vistos` impede laço — a FK não proíbe
 * um ciclo escrito à mão no banco.
 */
function origemDe(id: string, porId: ReadonlyMap<string, NotaDaConversa>): string {
  const vistos = new Set<string>();
  let atual = id;
  for (;;) {
    vistos.add(atual);
    const acima = porId.get(atual)?.resposta_de;
    if (!acima || !porId.has(acima) || vistos.has(acima)) return atual;
    atual = acima;
  }
}

/**
 * Quem recebe o aviso `note_reply` quando `eu` responde à anotação `alvoId`.
 *
 * - O autor do ALVO vem primeiro (o texto do aviso o trata como "sua
 *   anotação"); depois, na ordem da lista, quem mais escreveu na conversa.
 * - Fora: `eu`, autor que saiu do `auth.users` (nulo) e `jaAvisados` — quem
 *   foi MENCIONADO nesta resposta já recebe o `note_mention`, e dois avisos da
 *   mesma frase seriam ruído.
 */
export function quemAvisarDaResposta(
  notas: readonly NotaDaConversa[],
  alvoId: string,
  eu: string,
  jaAvisados: readonly string[] = []
): string[] {
  const porId = new Map(notas.map((n) => [n.id, n]));
  const origem = origemDe(alvoId, porId);
  const candidatos = [
    porId.get(alvoId)?.author_user_id ?? null,
    ...notas
      .filter((n) => origemDe(n.id, porId) === origem)
      .map((n) => n.author_user_id),
  ];
  const fora = new Set([eu, ...jaAvisados]);
  const saida: string[] = [];
  for (const id of candidatos) {
    if (!id || fora.has(id)) continue;
    fora.add(id);
    saida.push(id);
  }
  return saida;
}
