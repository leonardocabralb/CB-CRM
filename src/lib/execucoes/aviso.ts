// ============================================================
// "O conjunto de execuções mudou" — o aviso global (985).
//
// Mora aqui, e não dentro de `use-execucoes-do-contato.ts`, porque quem
// PROVOCA a mudança nem sempre é um componente: o aviso de drenagem do funil
// (`lib/automations/avisar-drenagem.ts`) é um módulo de biblioteca, e um lib
// importando um hook arrastaria React para dentro dele.
//
// ⚠️ Uma constante só. Três hooks escutam este mesmo nome
// (`useExecucoesDoContato`, `useExecucoesDoFio`, `useSinalDeExecucoes`), e uma
// segunda cópia da string faria o emissor gritar num canal que ninguém ouve —
// sem erro, sem log, com a marca do robô simplesmente parando de atualizar.
// ============================================================

/**
 * Evento global disparado por quem MUDA o conjunto de execuções de fora da
 * aba (o dialog "Executar automação" vive no fio, em outra árvore; a drenagem
 * do funil nem árvore tem). Os hooks escutam e recarregam — mais barato e mais
 * honesto que fiar um callback através de page → thread → composer.
 */
export const EVENTO_EXECUCOES = "cb:execucoes-mudaram";

/** Avisa todos os hooks de execução montados para recarregarem. */
export function avisarExecucoesMudaram(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENTO_EXECUCOES));
}
