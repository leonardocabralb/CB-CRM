"use client";

// ============================================================
// Menu lateral recolhido (só os ícones) — preferência deste navegador.
//
// `useSyncExternalStore` sobre o `localStorage`, como o modo anônimo: a
// barra lateral e o botão do cabeçalho leem o MESMO valor no mesmo render,
// sem contexto novo. O evento `storage` traz a troca feita em OUTRA aba; a
// própria aba se avisa pelo evento local. Com o armazenamento bloqueado, a
// escolha fica na memória desta aba (o botão continua funcionando).
//
// ⚠️ Só vale da largura `lg` para cima (`recolhido` já sai falso abaixo
// dela): no celular o menu é a gaveta, e a gaveta mostra sempre os nomes.
// ============================================================

import { useCallback, useSyncExternalStore } from "react";

import { useMediaQuery } from "@/hooks/use-media-query";

const CHAVE_DO_MENU_RECOLHIDO = "cb-menu-recolhido";
const AVISO_NESTA_ABA = "cb-menu-recolhido-mudou";

let naMemoria = false;

function lerGuardado(): boolean {
  try {
    return window.localStorage.getItem(CHAVE_DO_MENU_RECOLHIDO) === "1";
  } catch {
    return naMemoria;
  }
}

function assinar(avisar: () => void): () => void {
  const deOutraAba = (e: StorageEvent) => {
    if (e.key === null || e.key === CHAVE_DO_MENU_RECOLHIDO) avisar();
  };
  window.addEventListener("storage", deOutraAba);
  window.addEventListener(AVISO_NESTA_ABA, avisar);
  return () => {
    window.removeEventListener("storage", deOutraAba);
    window.removeEventListener(AVISO_NESTA_ABA, avisar);
  };
}

export function useMenuRecolhido(): {
  /** O menu está só com os ícones AGORA (preferência + tela larga). */
  recolhido: boolean;
  alternar: () => void;
} {
  const preferido = useSyncExternalStore(assinar, lerGuardado, () => false);
  const telaLarga = useMediaQuery("(min-width: 1024px)");

  const alternar = useCallback(() => {
    const novo = !lerGuardado();
    try {
      if (novo) {
        window.localStorage.setItem(CHAVE_DO_MENU_RECOLHIDO, "1");
      } else {
        window.localStorage.removeItem(CHAVE_DO_MENU_RECOLHIDO);
      }
    } catch {
      naMemoria = novo;
    }
    window.dispatchEvent(new Event(AVISO_NESTA_ABA));
  }, []);

  return { recolhido: preferido && telaLarga, alternar };
}
