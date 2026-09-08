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
 */

export type ResultadoDaExclusao =
  /** Todos saíram. */
  | "apagado"
  /** Nenhum saiu, e não houve erro: a policy recusou em silêncio. */
  | "recusado"
  /** Alguns saíram — parte foi recusada, ou já não existia. */
  | "parcial"
  /** A consulta em si falhou. */
  | "falhou";

export function lerExclusao(args: {
  /** Quantos contatos se pediu para apagar. */
  pedidos: number;
  /** Quantos o banco devolveu no `RETURNING` (`.select()` depois do delete). */
  apagados: number;
  houveErro: boolean;
}): ResultadoDaExclusao {
  if (args.houveErro) return "falhou";
  if (args.apagados === 0) return "recusado";
  if (args.apagados < args.pedidos) return "parcial";
  return "apagado";
}

/**
 * A seleção pode ser limpa? Só quando TUDO saiu — limpar sobre contato que
 * ficou esconde o que não foi apagado, e o operador só descobre no reload.
 */
export function podeLimparSelecao(r: ResultadoDaExclusao): boolean {
  return r === "apagado";
}
