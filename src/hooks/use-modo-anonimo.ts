"use client";

// ============================================================
// Modo anônimo — o estado, guardado neste navegador (a regra pura está em
// `@/lib/inbox/modo-anonimo`).
//
// `useSyncExternalStore` sobre o `localStorage`: o cabeçalho, a página do
// inbox e o fio leem o MESMO valor no mesmo render, sem contexto novo. O
// evento `storage` traz a troca feita em OUTRA aba; a própria aba se avisa
// pelo evento local. Armazenamento bloqueado lê como desligado — a pastilha
// não acende, e a tela nunca afirma um modo que não está valendo.
// ============================================================

import { useCallback, useSyncExternalStore } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  CHAVE_DO_MODO_ANONIMO,
  modoAnonimoAtivo,
  podeUsarModoAnonimo,
} from "@/lib/inbox/modo-anonimo";

const AVISO_NESTA_ABA = "cb-modo-anonimo-mudou";

function lerGuardado(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_DO_MODO_ANONIMO);
  } catch {
    return null;
  }
}

function assinar(avisar: () => void): () => void {
  const deOutraAba = (e: StorageEvent) => {
    if (e.key === null || e.key === CHAVE_DO_MODO_ANONIMO) avisar();
  };
  window.addEventListener("storage", deOutraAba);
  window.addEventListener(AVISO_NESTA_ABA, avisar);
  return () => {
    window.removeEventListener("storage", deOutraAba);
    window.removeEventListener(AVISO_NESTA_ABA, avisar);
  };
}

export interface ModoAnonimo {
  /** Esta pessoa pode ligar o modo (administrador, pelo papel real). */
  disponivel: boolean;
  /** O modo está valendo agora. */
  ativo: boolean;
  /** Liga ou desliga. `false` = o navegador recusou guardar (nada mudou). */
  definir: (ligar: boolean) => boolean;
}

export function useModoAnonimo(): ModoAnonimo {
  const { user, profile } = useAuth();
  const guardado = useSyncExternalStore(assinar, lerGuardado, () => null);
  const papelReal = profile?.account_role ?? null;
  const userId = user?.id ?? null;
  const disponivel = podeUsarModoAnonimo(papelReal);

  const definir = useCallback(
    (ligar: boolean) => {
      if (!userId || (ligar && !disponivel)) return false;
      try {
        if (ligar) {
          window.localStorage.setItem(CHAVE_DO_MODO_ANONIMO, userId);
        } else {
          window.localStorage.removeItem(CHAVE_DO_MODO_ANONIMO);
        }
      } catch {
        return false;
      }
      window.dispatchEvent(new Event(AVISO_NESTA_ABA));
      return true;
    },
    [userId, disponivel],
  );

  return {
    disponivel,
    ativo: modoAnonimoAtivo(guardado, userId, papelReal),
    definir,
  };
}
