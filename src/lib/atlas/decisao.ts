/**
 * Puro: o que o passo "Criar cliente no Atlas" faz com o que achou.
 *
 * - Nada achado → CRIAR.
 * - Um cliente "encerrado" no Atlas (rescindido, finalizado, inativo,
 *   suspenso — o grupo "Finalizados" da tela do Atlas) → REATIVAR o mesmo
 *   cadastro (D3: nunca criar outro para quem volta).
 * - Um cliente em qualquer outra situação (ativo, importado, uma que o Atlas
 *   venha a criar) → só VINCULAR: o Atlas manda no contrato (D2), e o CRM não
 *   escreve por cima de quem já está em curso lá.
 * - Mais de um → AMBÍGUO: o passo para e diz por quê (duas fichas no Atlas
 *   para a mesma pessoa é decisão de gente, nunca palpite do CRM).
 */

import type { ClienteDoAtlas } from "./cliente";

/** O grupo "Finalizados" do Atlas: quem volta a fechar contrato é reativado. */
export const SITUACOES_ENCERRADAS = ["rescindido", "finalizado", "inativo", "suspenso"] as const;

export type Decisao =
  | { acao: "criar" }
  | { acao: "reativar"; cliente: ClienteDoAtlas }
  | { acao: "vincular"; cliente: ClienteDoAtlas }
  | { acao: "ambiguo"; quantos: number };

export function estaEncerrado(status: string | null): boolean {
  return (SITUACOES_ENCERRADAS as readonly string[]).includes((status ?? "").trim().toLowerCase());
}

export function decidir(encontrados: ClienteDoAtlas[], truncado = false): Decisao {
  if (encontrados.length === 0 && !truncado) return { acao: "criar" };
  if (encontrados.length !== 1 || truncado) return { acao: "ambiguo", quantos: encontrados.length };
  const [cliente] = encontrados;
  return estaEncerrado(cliente.status) ? { acao: "reativar", cliente } : { acao: "vincular", cliente };
}
