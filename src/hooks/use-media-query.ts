"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `window.matchMedia` como estado React, via useSyncExternalStore.
 *
 * ⚠️ O snapshot de SERVIDOR é `false` ("mobile"), e o React usa esse
 * mesmo valor no render de hidratação — só depois compara com o snapshot
 * real do cliente e re-renderiza se divergir. É o que mantém qualquer
 * ATRIBUTO derivado daqui (`inert`, `aria-*`) idêntico ao HTML do
 * servidor, sem aviso de hidratação. Quem consome aceita um primeiro
 * paint com o valor "mobile"; o shim de flow-editor-shell.tsx lê o valor
 * síncrono no useState e não tem essa garantia — não trocar um pelo
 * outro sem olhar o consumidor.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
