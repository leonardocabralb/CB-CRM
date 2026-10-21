"use client";

// ============================================================
// O rascunho da conversa aberta, por pessoa, guardado neste navegador — a
// regra pura está em `@/lib/inbox/rascunho-da-conversa`.
//
// `useSyncExternalStore` sobre um repositório de MÓDULO (a memória da aba +
// o `localStorage`), como o modo anônimo: o render lê o rascunho da conversa
// do PRÓPRIO render, sem efeito no meio — o texto da conversa anterior nunca
// aparece, nem por um quadro, na caixa da conversa nova. O evento `storage`
// traz o que outra aba escreveu.
//
// ⚠️⚠️ O `definir` é PRESO à conversa do render em que nasceu (a identidade
// muda com a conversa). É de propósito: quem escreve DEPOIS de uma espera —
// a sugestão da IA, o agendamento que limpa o campo — escreve no rascunho da
// conversa de ORIGEM, nunca no da conversa aberta quando a resposta chega.
// Por isso todo `useCallback` que o chama o leva nas dependências: um
// `definir` velho escreveria na conversa anterior.
// ============================================================

import { useCallback, useSyncExternalStore } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  chaveDoRascunho,
  criarRepositorio,
  PREFIXO_DO_RASCUNHO,
  varrerVencidos,
  type NovoTexto,
} from "@/lib/inbox/rascunho-da-conversa";

const AVISO_NESTA_ABA = "cb-rascunho-mudou";

function armazenamento(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const repositorio = criarRepositorio(armazenamento, () =>
  window.dispatchEvent(new Event(AVISO_NESTA_ABA)),
);

// Uma vez por carga de página: a varredura dos vencidos e o ouvinte de
// OUTRA aba (um só, e não um por assinante — cada um reavisaria todos).
let ligado = false;
function ligarUmaVez() {
  if (ligado) return;
  ligado = true;
  try {
    const a = armazenamento();
    if (a) varrerVencidos(a, Date.now());
  } catch {
    // Sem varredura; a leitura de cada chave ainda limpa o vencido.
  }
  window.addEventListener("storage", (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith(PREFIXO_DO_RASCUNHO)) {
      repositorio.esquecer(e.key);
    }
  });
}

function assinar(avisar: () => void): () => void {
  ligarUmaVez();
  window.addEventListener(AVISO_NESTA_ABA, avisar);
  return () => window.removeEventListener(AVISO_NESTA_ABA, avisar);
}

export function useRascunhoDaConversa(
  conversationId: string,
): [string, (novo: NovoTexto) => void] {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Sem login conhecido, o rascunho vale só na memória desta aba: gravado sob
  // uma chave sem dono, ficaria para quem entrar depois neste navegador.
  const chave = chaveDoRascunho(userId ?? "sem-login", conversationId);
  const texto = useSyncExternalStore(
    assinar,
    () => repositorio.ler(chave),
    () => "",
  );
  const definir = useCallback(
    (novo: NovoTexto) => repositorio.escrever(chave, novo, userId !== null),
    [chave, userId],
  );
  return [texto, definir];
}

/**
 * O texto do rascunho de uma conversa — a marca "Rascunho" da LISTA. Só lê.
 * `ativo: false` responde "" sem olhar (a conversa aberta: o rascunho dela
 * está à vista na caixa, e a linha dela se redesenharia a cada tecla).
 */
export function useTextoDoRascunho(conversationId: string, ativo: boolean): string {
  const { user } = useAuth();
  const chave = chaveDoRascunho(user?.id ?? "sem-login", conversationId);
  return useSyncExternalStore(
    assinar,
    () => (ativo ? repositorio.ler(chave) : ""),
    () => "",
  );
}
