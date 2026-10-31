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

// A escolha que o navegador RECUSOU gravar (armazenamento bloqueado, cota
// cheia). Vale por cima do `localStorage`: com a cota cheia a leitura ainda
// funciona e devolveria o valor antigo, e o botão não faria nada (Codex,
// PR #426). Volta a `null` na próxima gravação que der certo.
let naMemoria: boolean | null = null;

function lerGuardado(): boolean {
  if (naMemoria !== null) return naMemoria;
  try {
    return window.localStorage.getItem(CHAVE_DO_MENU_RECOLHIDO) === "1";
  } catch {
    return false;
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
  // `64rem`, NUNCA `1024px`: é o `lg:` do Tailwind, e `rem` em media query
  // segue a fonte PADRÃO do navegador. Com fonte grande, `1024px` recolheria
  // a gaveta do celular, onde o botão de expandir (`lg:flex`) não aparece
  // (Codex, PR #426; o mesmo caso da página do inbox).
  const telaLarga = useMediaQuery("(min-width: 64rem)");

  const alternar = useCallback(() => {
    const novo = !lerGuardado();
    try {
      if (novo) {
        window.localStorage.setItem(CHAVE_DO_MENU_RECOLHIDO, "1");
      } else {
        window.localStorage.removeItem(CHAVE_DO_MENU_RECOLHIDO);
      }
      naMemoria = null;
    } catch {
      naMemoria = novo;
    }
    window.dispatchEvent(new Event(AVISO_NESTA_ABA));
  }, []);

  return { recolhido: preferido && telaLarga, alternar };
}
