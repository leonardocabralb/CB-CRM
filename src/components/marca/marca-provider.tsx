"use client";

import { createContext, useContext, type ReactNode } from "react";

import { marcaPadrao, type Marca } from "@/lib/marca";

// A marca resolvida no servidor (`obterMarca()` no layout raiz) chega aqui
// pronta: o navegador nunca lê `cb_marca` (fechada a anon/authenticated, e
// o login precisa dela antes de haver sessão). Depois de gravar na aba
// Marca, `router.refresh()` refaz o layout e o provedor recebe a nova.

const MarcaContext = createContext<Marca | null>(null);

export function MarcaProvider({
  marca,
  children,
}: {
  marca: Marca;
  children: ReactNode;
}) {
  return <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>;
}

/**
 * A marca da instalação. Fora do provedor (teste de componente isolado),
 * o padrão do produto — nunca `undefined` na tela.
 */
export function useMarca(): Marca {
  return useContext(MarcaContext) ?? marcaPadrao();
}
