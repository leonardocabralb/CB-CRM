// ============================================================
// Os ANEXOS em rascunho POR CONVERSA, na memória desta aba (pedido do
// operador, 21/10/2026: "como o WhatsApp faz"). Trocar de conversa guarda a
// fila de anexos — com as legendas — da conversa que ficou para trás, e
// voltar a ela devolve tudo, pronto para enviar.
//
// SÓ NA MEMÓRIA, por decisão do operador: recarregar ou fechar a aba perde os
// anexos, como no WhatsApp. O texto do rascunho é outra peça e continua no
// `localStorage` (`rascunho-da-conversa.ts`). O arquivo já subiu para o
// bucket quando foi anexado; o que se guarda aqui é o endereço dele.
//
// A chave leva o LOGIN: sem recarregar, a mesma aba pode trocar de pessoa
// ("Sair" e entrar com outra), e a fila de quem saiu não aparece para quem
// entrou.
//
// Este módulo é a regra pura (o teste roda sem navegador nem React). Quem a
// liga ao React é `useAnexosDaConversa` (`src/hooks/use-anexos-da-conversa.ts`);
// a instância é de MÓDULO, no compositor, como a fila de saída: o compositor
// que remonta (saiu da caixa de entrada e voltou) lê a mesma fila.
// ============================================================

export function chaveDosAnexos(userId: string, conversationId: string): string {
  return `${userId}:${conversationId}`;
}

/** A fila nova, ou a conta sobre a fila de AGORA. */
export type NovosAnexos<T> = readonly T[] | ((atual: readonly T[]) => readonly T[]);

/** Conversa sem anexos. Uma instância só: o React compara por identidade. */
export const SEM_ANEXOS: readonly never[] = Object.freeze([]);

export interface RepositorioDeAnexos<T> {
  /**
   * A fila da chave — a MESMA instância até ela mudar: o `getSnapshot` do
   * `useSyncExternalStore` é relido a cada render, e um array novo a cada
   * leitura faria o React renderizar sem fim.
   */
  ler(chave: string): readonly T[];
  /**
   * Troca a fila da chave e avisa quem assina, só quando muda. A função
   * recebe a fila de AGORA (um upload pode ter pousado no mesmo quadro) e
   * roda UMA vez. Fila vazia sai do mapa.
   */
  escrever(chave: string, novo: NovosAnexos<T>): void;
  /** Para o `useSyncExternalStore`: devolve quem cancela a assinatura. */
  assinar(avisar: () => void): () => void;
}

export function criarRepositorioDeAnexos<T>(): RepositorioDeAnexos<T> {
  const filas = new Map<string, readonly T[]>();
  const assinantes = new Set<() => void>();

  function ler(chave: string): readonly T[] {
    return filas.get(chave) ?? SEM_ANEXOS;
  }

  function escrever(chave: string, novo: NovosAnexos<T>): void {
    const atual = ler(chave);
    const proxima = typeof novo === "function" ? novo(atual) : novo;
    if (proxima === atual) return;
    if (proxima.length === 0) {
      if (!filas.has(chave)) return;
      filas.delete(chave);
    } else {
      filas.set(chave, proxima);
    }
    for (const avisar of [...assinantes]) avisar();
  }

  function assinar(avisar: () => void): () => void {
    assinantes.add(avisar);
    return () => {
      assinantes.delete(avisar);
    };
  }

  return { ler, escrever, assinar };
}
