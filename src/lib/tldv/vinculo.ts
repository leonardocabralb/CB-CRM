/**
 * Vínculo automático reunião → cliente, pelo E-MAIL do convidado — puro.
 *
 * O tl;dv só conhece e-mail (não há telefone no payload). A regra:
 * 1. dos convidados e do organizador, tiram-se os e-mails da EQUIPE (os
 *    perfis da conta) — o advogado está em toda reunião e nunca é o cliente;
 * 2. o que sobra são os e-mails "de fora", sem repetição;
 * 3. procura-se contato da conta com um desses e-mails. Vincula SÓ quando
 *    todos os achados apontam para UM contato — dois clientes na mesma
 *    reunião é decisão de gente, não de regra.
 */

import type { ReuniaoDoTldv } from "./leitura";

export function normalizarEmail(v: string | null | undefined): string | null {
  const e = (v ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Os e-mails que podem ser de cliente, já sem a equipe e sem repetição. */
export function emailsDeFora(reuniao: Pick<ReuniaoDoTldv, "organizador" | "convidados">, emailsDaEquipe: Iterable<string>): string[] {
  const equipe = new Set<string>();
  for (const e of emailsDaEquipe) {
    const n = normalizarEmail(e);
    if (n) equipe.add(n);
  }
  const vistos = new Set<string>();
  const saida: string[] = [];
  const pessoas = [...reuniao.convidados, ...(reuniao.organizador ? [reuniao.organizador] : [])];
  for (const p of pessoas) {
    const e = normalizarEmail(p.email);
    if (!e || equipe.has(e) || vistos.has(e)) continue;
    vistos.add(e);
    saida.push(e);
  }
  return saida;
}

/**
 * Entre os contatos achados pelos e-mails, o ÚNICO a vincular — ou `null`
 * quando não há nenhum ou há mais de um (aí fica para a mão).
 */
export function contatoParaVincular(achados: readonly { id: string }[]): string | null {
  const ids = new Set(achados.map((c) => c.id));
  return ids.size === 1 ? [...ids][0] : null;
}
