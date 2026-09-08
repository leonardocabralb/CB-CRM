/**
 * O que dizer depois de um DELETE de contato — puro, porque a frase que a
 * tela mostra é uma AFIRMAÇÃO sobre o que aconteceu no banco.
 *
 * ⚠️⚠️ A armadilha de origem: **RLS que barra DELETE devolve 0 linhas com
 * `error: null`**. Olhando só o erro, a tela anunciava "contato excluído"
 * sobre um contato intacto — e depois da 981 (apagar contato é de admin)
 * esse é o caso real de qualquer aba aberta antes do deploy (Codex, #137).
 *
 * ⚠️⚠️ E zero linhas tem DOIS significados: a policy recusou, ou a linha JÁ
 * NÃO EXISTIA (outro cliente a apagou depois que a lista carregou). O
 * rowcount não separa os dois.
 *
 * ⚠️⚠️ A primeira tentativa de separá-los usou o que a TELA sabia da própria
 * permissão. Estava errada, e o Codex mostrou o caminho (#139): um admin
 * REBAIXADO com a página aberta mantém `accountRole` antigo em memória (o
 * provider não refaz o perfil em evento de auth do mesmo usuário), então a
 * tela "sabia" que podia enquanto o banco já recusava — e anunciava que
 * alguém tinha apagado o contato que a recarga mostrava de volta.
 *
 * A régua passou a ser MEDIDA, não inferida: depois de um DELETE incompleto,
 * pergunta-se ao banco quais dos pedidos AINDA EXISTEM. Os que existem foram
 * recusados; os que não existem, sumiram. Nenhum estado em cache participa.
 */

export type ResultadoDaExclusao =
  /** Todos saíram. */
  | "apagado"
  /** Nada saiu, e o que se pediu continua lá: a policy recusou. */
  | "recusado"
  /** Nada saiu, e nada mais existe: outro cliente apagou antes. */
  | "sumiu"
  /** Parte saiu. */
  | "parcial"
  /** A consulta em si falhou — ou a conferência não pôde ser feita. */
  | "falhou";

export function lerExclusao(args: {
  /** Quantos contatos se pediu para apagar. */
  pedidos: number;
  /** Quantos o banco devolveu no `RETURNING` (`.select()` depois do delete). */
  apagados: number;
  /**
   * Dos pedidos que NÃO saíram, quantos ainda existem no banco — medido por
   * uma consulta, nunca inferido. `null` = a conferência falhou, e aí não se
   * sabe o motivo: vira `falhou`, que é a única resposta honesta.
   */
  aindaExistem: number | null;
  houveErro: boolean;
}): ResultadoDaExclusao {
  if (args.houveErro) return "falhou";
  if (args.apagados >= args.pedidos) return "apagado";
  if (args.aindaExistem === null) return "falhou";
  if (args.apagados > 0) return "parcial";
  return args.aindaExistem > 0 ? "recusado" : "sumiu";
}

/**
 * A seleção pode ser limpa INTEIRA? Só quando tudo saiu.
 *
 * ⚠️ Não basta devolver `false` aqui: a recarga da lista limpa a seleção por
 * conta própria (as linhas visíveis mudam), então quem recarrega depois de
 * uma recusa precisa pedir para PRESERVAR. Sem esse par a invariante desta
 * função não vale na prática (Codex, #138).
 */
export function podeLimparSelecao(r: ResultadoDaExclusao): boolean {
  return r === "apagado";
}

/**
 * O que sobra selecionado: só o que continua existindo E não saiu.
 *
 * ⚠️ Os RESOLVIDOS são dois grupos, não um: os que saíram e os que já não
 * existiam. Manter o segundo deixava um contato invisível marcado na barra
 * de seleção, e cada nova tentativa de apagá-lo repetia "sumiu" para sempre
 * (Codex, #139). Sobra o que foi RECUSADO — que é justamente o que o
 * operador ainda precisa resolver.
 */
export function selecaoRestante(
  selecionados: Iterable<string>,
  resolvidos: readonly string[],
): Set<string> {
  const fora = new Set(resolvidos);
  return new Set([...selecionados].filter((id) => !fora.has(id)));
}
