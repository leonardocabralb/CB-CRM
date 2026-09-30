/**
 * Puro: o que o passo "Criar cliente no Atlas" faz com o que achou.
 *
 * - Nada achado → CRIAR.
 * - Mais de um, ou lista cortada → AMBÍGUO: o passo para e diz por quê (duas
 *   fichas no Atlas para a mesma pessoa é decisão de gente, nunca palpite).
 * - Um só, mas casado só por sinal FRACO (os 8 últimos dígitos de um telefone
 *   guardado sem DDD, ou só o e-mail) → FRACO: o passo para. ⚠️ Reativar ou
 *   vincular pelo sinal fraco escreveria o contrato de uma pessoa no cadastro
 *   de OUTRA (o cônjuge com o mesmo e-mail; outro DDD com o mesmo final).
 * - Um só, com sinal forte (o link da conversa do CRM, o telefone completo):
 *   - rescindido, finalizado ou inativo → REATIVAR o mesmo cadastro (D3:
 *     nunca criar outro para quem volta; inativo por decisão do operador,
 *     30/09/2026);
 *   - suspenso → PAUSADO: o passo para (D2: o Atlas manda no contrato, e a
 *     equipe suspendeu lá de propósito — reativar é decisão dela);
 *   - qualquer outra situação (ativo, importado, uma que o Atlas crie) → só
 *     VINCULAR: o CRM não escreve por cima de quem está em curso.
 */

import type { ClienteDoAtlas } from "./cliente";

/** Quem volta a fechar contrato é reativado (D3; `inativo` por decisão do operador, 30/09/2026). */
export const SITUACOES_ENCERRADAS = ["rescindido", "finalizado", "inativo"] as const;
/** A equipe suspendeu no Atlas: o passo para, e ela decide lá. */
export const SITUACOES_PAUSADAS = ["suspenso"] as const;
/** Os `matched_by` do `find_clients` que bastam para o passo agir sozinho. */
export const CASAMENTOS_FORTES = ["chat_link", "phone", "doc_id"] as const;

export type Decisao =
  | { acao: "criar" }
  | { acao: "reativar"; cliente: ClienteDoAtlas }
  | { acao: "vincular"; cliente: ClienteDoAtlas }
  | { acao: "pausado"; cliente: ClienteDoAtlas }
  | { acao: "fraco"; cliente: ClienteDoAtlas }
  | { acao: "ambiguo"; quantos: number };

function normal(status: string | null): string {
  return (status ?? "").trim().toLowerCase();
}

export function estaEncerrado(status: string | null): boolean {
  return (SITUACOES_ENCERRADAS as readonly string[]).includes(normal(status));
}

export function estaPausado(status: string | null): boolean {
  return (SITUACOES_PAUSADAS as readonly string[]).includes(normal(status));
}

/** Sem `matched_by` (o Atlas não disse) conta como FRACO: falha fechada. */
export function casouForte(cliente: ClienteDoAtlas): boolean {
  return (cliente.casouPor ?? []).some((m) => (CASAMENTOS_FORTES as readonly string[]).includes(m));
}

/** O cliente é deste contato (pelo vínculo, ou por casamento forte): o que fazer pela situação. */
export function decidirPelaSituacao(cliente: ClienteDoAtlas): Decisao {
  if (estaEncerrado(cliente.status)) return { acao: "reativar", cliente };
  if (estaPausado(cliente.status)) return { acao: "pausado", cliente };
  return { acao: "vincular", cliente };
}

export function decidir(encontrados: ClienteDoAtlas[], truncado = false): Decisao {
  if (encontrados.length === 0 && !truncado) return { acao: "criar" };
  if (encontrados.length !== 1 || truncado) return { acao: "ambiguo", quantos: encontrados.length };
  const [cliente] = encontrados;
  if (!casouForte(cliente)) return { acao: "fraco", cliente };
  return decidirPelaSituacao(cliente);
}
