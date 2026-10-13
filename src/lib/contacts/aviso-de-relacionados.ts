// ============================================================
// "Os vínculos de Contatos relacionados mudaram" — o aviso global (1069).
//
// Duas telas leem os vínculos e moram em árvores diferentes: a aba
// Relacionados do painel (`useContatosRelacionados`) e a faixa "Possível
// duplicata" do fio (`usePossiveisDuplicatas`: o par ligado sai do aviso, o
// desvinculado volta). Quem grava — a aba ou o "Ligar as fichas" do
// "Comparar" — avisa, e as duas recarregam. Sem isto, ligar pelo "Comparar"
// dizia "fichas ligadas em Relacionados" com a aba ainda vazia, e
// desvincular na aba não devolvia o aviso até reabrir a conversa.
//
// ⚠️ Uma constante só: uma segunda cópia da string faria o emissor gritar
// num canal que ninguém ouve, sem erro (a lição de `execucoes/aviso.ts`).
// ============================================================

export const EVENTO_RELACIONADOS = "cb:relacionados-mudaram";

/** Avisa os hooks montados (inclusive o de quem gravou) para recarregarem. */
export function avisarRelacionadosMudaram(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_RELACIONADOS));
}
