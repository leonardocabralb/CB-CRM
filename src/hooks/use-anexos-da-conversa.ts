"use client";

// ============================================================
// A fila de anexos em rascunho da conversa aberta, por pessoa, na memória
// desta aba — a regra pura e o porquê estão em `@/lib/inbox/anexos-da-conversa`.
//
// `useSyncExternalStore` sobre o repositório de MÓDULO do compositor: o render
// lê a fila da conversa do PRÓPRIO render, sem efeito no meio — o anexo da
// conversa anterior nunca aparece, nem por um quadro, na prévia da conversa
// nova (efeito passivo, seção 8c do CLAUDE.md).
//
// ⚠️⚠️ O `gravar` e o `lerAgora` são PRESOS à conversa do render em que
// nasceram (a identidade muda com ela), como o `setText` do rascunho de
// texto. É de propósito: quem grava DEPOIS de uma espera — o upload que
// pousa, o anexo que falhou, o agendamento — grava na fila da conversa de
// ORIGEM, nunca na da conversa aberta quando a resposta chega. Por isso todo
// `useCallback` que os chama os leva nas dependências.
// ============================================================

import { useCallback, useSyncExternalStore } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  chaveDosAnexos,
  SEM_ANEXOS,
  type NovosAnexos,
  type RepositorioDeAnexos,
} from "@/lib/inbox/anexos-da-conversa";

export function useAnexosDaConversa<T>(
  repositorio: RepositorioDeAnexos<T>,
  conversationId: string,
): [readonly T[], (novo: NovosAnexos<T>) => void, () => readonly T[]] {
  const { user } = useAuth();
  // Login ainda desconhecido: uma chave à parte, que ninguém mais lê. Os
  // uploads exigem sessão, então nada costuma cair nela.
  const chave = chaveDosAnexos(user?.id ?? "sem-login", conversationId);
  const fila = useSyncExternalStore(
    repositorio.assinar,
    () => repositorio.ler(chave),
    () => SEM_ANEXOS,
  );
  const gravar = useCallback(
    (novo: NovosAnexos<T>) => repositorio.escrever(chave, novo),
    [repositorio, chave],
  );
  // A fila de AGORA, para quem não pode esperar o próximo render: o descarte
  // e o funil de entrada (um upload pode ter pousado no mesmo quadro).
  const lerAgora = useCallback(() => repositorio.ler(chave), [repositorio, chave]);
  return [fila, gravar, lerAgora];
}
