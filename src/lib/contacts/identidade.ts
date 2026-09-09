// ============================================================
// A identidade LEGÍVEL de um contato — o que a tela mostra "embaixo do
// nome", e o que vira nome quando não há nome.
//
// Até a migration 989 todo contato tinha telefone, e a base inteira dizia
// `contact.name || contact.phone`. Uma ficha só do Instagram tem `phone`
// NULO: aquele `||` cai em `null`, um `${contact.phone}` imprime "null",
// e a linha de baixo do cabeçalho fica vazia. Estas duas funções são o
// lugar único da regra — telefone, senão o `@`, senão o que o chamador
// decidir mostrar.
//
// Puro, sem formatação de telefone: as telas mostram o número como ele
// está gravado (E.164), e formatar aqui mudaria toda tela de uma vez.
// ============================================================

export interface ContatoIdentificavel {
  name?: string | null;
  phone?: string | null;
  instagram_username?: string | null;
  instagram_id?: string | null;
}

/**
 * Telefone, senão `@usuario` do Instagram, senão `null`. Ficha do Instagram
 * cujo perfil ainda não foi lido (sem `@`) devolve `null` — mostrar o IGSID
 * de 17 dígitos no lugar seria pior que a linha vazia.
 */
export function identidadeDoContato(c: ContatoIdentificavel): string | null {
  if (c.phone) return c.phone;
  if (c.instagram_username) return `@${c.instagram_username}`;
  return null;
}

/**
 * O nome para exibir: o nome, senão a identidade, senão `fallback` — que é
 * OBRIGATÓRIO porque cada tela tem o seu ("Cliente", "Sem contato", o
 * `t('unknownContact')`), e um padrão escondido aqui apareceria em inglês
 * numa tela e em português noutra.
 */
export function nomeDoContato(
  c: ContatoIdentificavel | null | undefined,
  fallback: string
): string {
  if (!c) return fallback;
  const nome = c.name?.trim();
  if (nome) return nome;
  return identidadeDoContato(c) ?? fallback;
}
