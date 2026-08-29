"use client";

// ============================================================
// Wrapper fino — o painel de verdade vive em
// `painel/painel-do-contato.tsx` (arquivo NOSSO).
//
// Este arquivo é do upstream e a cada merge ele volta a ser mexido lá.
// Mantê-lo como re-export reduz a superfície de conflito: a evolução
// do painel acontece no módulo novo, e um merge futuro que reescreva
// este arquivo resolve-se com "manter o nosso", sem arrastar a UI
// junto. (Mesma tática do multi-canal: módulos novos, core fino.)
// ============================================================

export {
  PainelDoContato as ContactSidebar,
  type PainelDoContatoProps as ContactSidebarProps,
} from "./painel/painel-do-contato";
