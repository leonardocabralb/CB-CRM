/**
 * O que dizer depois de um DELETE de contato — puro, porque a frase que a
 * tela mostra é uma AFIRMAÇÃO sobre o que aconteceu no banco.
 *
 * ⚠️⚠️ Existe por causa de uma armadilha que o CLAUDE.md já documentava e
 * que a página de contatos repetia: **RLS que barra DELETE devolve 0 linhas
 * com `error: null`**. Olhando só o erro, a tela anunciava "contato
 * excluído" sobre um contato intacto — e depois da 981 (apagar contato é de
 * admin) esse é o caso REAL de quem estava com a página aberta quando a
 * policy mudou, ou de qualquer aba antiga (achado do Codex no PR #137).
 *
 * ⚠️ E o número importa: o toast em massa dizia quantos foram PEDIDOS, não
 * quantos saíram. Com a policy recusando, ele anunciava "12 contatos
 * excluídos" sobre zero.
 *
 * ⚠️⚠️ ZERO LINHAS TEM DOIS SIGNIFICADOS, e o rowcount sozinho não os
 * separa: ou a policy recusou, ou a linha JÁ NÃO EXISTIA — outro cliente a
 * apagou depois que esta lista carregou. Dizer "seu perfil não tem
 * permissão" a um admin que perdeu a corrida é afirmar o que não houve
 * (achado do Codex no PR #138). Por isso `podeApagar` entra na conta: é o
 * que a tela SABE sobre a própria permissão.
 */

export type ResultadoDaExclusao =
  /** Todos saíram. */
  | "apagado"
  /** Nenhum saiu, e quem pediu não tem permissão: a policy recusou. */
  | "recusado"
  /** Nenhum saiu, mas quem pediu PODE apagar: a linha já não existia. */
  | "sumiu"
  /** Alguns saíram — parte foi recusada, ou parte já não existia. */
  | "parcial"
  /** A consulta em si falhou. */
  | "falhou";

export function lerExclusao(args: {
  /** Quantos contatos se pediu para apagar. */
  pedidos: number;
  /** Quantos o banco devolveu no `RETURNING` (`.select()` depois do delete). */
  apagados: number;
  houveErro: boolean;
  /** O que a TELA sabe sobre a permissão de quem clicou (`canDeleteContacts`). */
  podeApagar: boolean;
}): ResultadoDaExclusao {
  if (args.houveErro) return "falhou";
  if (args.apagados === 0) return args.podeApagar ? "sumiu" : "recusado";
  if (args.apagados < args.pedidos) return "parcial";
  return "apagado";
}

/**
 * A seleção pode ser limpa INTEIRA? Só quando tudo saiu.
 *
 * ⚠️ Não basta devolver `false` aqui: a recarga da lista limpa a seleção por
 * conta própria (as linhas visíveis mudam), então quem recarrega depois de
 * uma recusa precisa pedir para PRESERVAR. Sem isso a invariante desta
 * função não vale na prática — foi o que o Codex apontou no PR #138.
 */
export function podeLimparSelecao(r: ResultadoDaExclusao): boolean {
  return r === "apagado";
}

/**
 * O que sobra selecionado depois de uma exclusão que apagou só parte.
 * Tira os que saíram e mantém o resto — deselecionar quem ficou esconde
 * justamente o que o operador ainda precisa resolver.
 */
export function selecaoRestante(
  selecionados: Iterable<string>,
  apagados: readonly string[],
): Set<string> {
  const saiu = new Set(apagados);
  return new Set([...selecionados].filter((id) => !saiu.has(id)));
}
