"use client";

// ============================================================
// A aba está À VISTA? (decisão do operador, 30/10/2026: aba escondida não
// lê). Escondida = outra aba na frente, janela minimizada ou, no Chrome,
// janela inteira coberta por outro programa; no celular, o app em segundo
// plano. Segundo monitor e janela parcialmente coberta contam como à vista.
//
// `useSyncExternalStore` sobre o `visibilitychange`: a página, o fio e o
// escritor da presença leem o MESMO valor no mesmo render.
// ============================================================

import { useSyncExternalStore } from "react";

function assinar(avisar: () => void): () => void {
  document.addEventListener("visibilitychange", avisar);
  return () => document.removeEventListener("visibilitychange", avisar);
}

/** Só `hidden` esconde: um estado que o navegador não conheça conta como à vista. */
function lerVisivel(): boolean {
  return document.visibilityState !== "hidden";
}

export function useAbaVisivel(): boolean {
  return useSyncExternalStore(assinar, lerVisivel, () => true);
}
