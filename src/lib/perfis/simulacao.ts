// ============================================================
// Simulação de perfil — "ver o CRM como este perfil".
//
// Pedido do operador (2026-09-03): "como administrador, poder simular o que
// algum desses perfis vai conseguir visualizar, pra eu saber como ele está
// configurado". É uma troca de LENTE no navegador, e só nele: o AuthProvider
// substitui o papel e o perfil que entrega ao app pelos do perfil simulado,
// e tudo que decide acesso no cliente — menu, seções de Configurações, tela
// bloqueada, recorte de conexões e funis, botões por `useCan`/`RequireRole`
// — segue sozinho, porque tudo lê do mesmo lugar.
//
// ⚠️ O SERVIDOR NÃO PARTICIPA. `requireRole` e a RLS continuam vendo o
// administrador de verdade. A simulação responde "o que este perfil VÊ e
// quais botões perde", que é exatamente o que os perfis prometem (a 956
// diz por escrito que são restrição de visualização, não de segurança).
// Não é teste de segurança, e a faixa na tela diz isso.
//
// ⚠️ NUNCA ESCALA. Só é honrada quando o papel REAL administra a conta
// (admin ou dono), e o alvo só pode ser admin/agent/viewer (o CHECK da 956
// barra owner). Uma chave de sessionStorage plantada à mão por um agent é
// ignorada aqui — e mesmo que não fosse, o servidor recusaria a escrita.
// ============================================================

import { canManageMembers, type AccountRole } from "@/lib/auth/roles";
import type { ContextoDeAcesso, PerfilDeAcesso } from "./tipos";

/** Chave do `sessionStorage`: por ABA — sobrevive ao reload, morre com a aba. */
export const CHAVE_DA_SIMULACAO = "cb-simulacao-de-perfil";

/** Quem pode simular: quem administra a conta (admin ou dono). */
export function podeSimular(papelReal: AccountRole | null): boolean {
  return papelReal !== null && canManageMembers(papelReal);
}

export interface AcessoResolvido {
  /** O que o app deve enxergar. */
  acesso: ContextoDeAcesso;
  /** O perfil simulado em vigor, ou `null` quando o acesso é o real. */
  simulado: PerfilDeAcesso | null;
}

/**
 * O acesso efetivo: o do alvo quando há alvo E o papel real permite E o
 * alvo é desta conta; o real caso contrário. Alvo de outra conta é
 * recusado por decisão (a RLS já não o entregaria, mas a checagem é barata
 * e explícita). O dono que simula PERDE o curto-circuito de dono — é o
 * ponto: ele quer ver o que a outra pessoa vê.
 */
export function resolverAcesso(
  real: ContextoDeAcesso,
  alvo: PerfilDeAcesso | null,
  accountId: string | null,
): AcessoResolvido {
  if (!alvo || !podeSimular(real.papel) || alvo.account_id !== accountId) {
    return { acesso: real, simulado: null };
  }
  return { acesso: { papel: alvo.papel_base, perfil: alvo }, simulado: alvo };
}
