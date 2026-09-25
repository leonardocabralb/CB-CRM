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
//
// Fase 11.4: a Meta também deixou de mandar o telefone de quem adotou nome
// de usuário no WhatsApp — a ficha dessa pessoa tem só o BSUID
// (`wa_user_id`) e, quando a Meta o manda, o `wa_username`. A ordem
// (decisão do operador, 24/09/2026): telefone, senão o `@` do WhatsApp,
// senão o do Instagram. O `@` puro, sem dizer de onde veio.
// ============================================================

export interface ContatoIdentificavel {
  name?: string | null;
  phone?: string | null;
  /** `@` do WhatsApp (1038): a ficha só-BSUID não tem telefone. */
  wa_username?: string | null;
  instagram_username?: string | null;
  instagram_id?: string | null;
}

/**
 * Telefone, senão `@usuario` do WhatsApp, senão o do Instagram, senão
 * `null`. Ficha sem `@` devolve `null` — mostrar o IGSID de 17 dígitos ou o
 * BSUID ("BR.1349…") no lugar seria pior que a linha vazia. O BSUID
 * (`wa_user_id`) NUNCA aparece: é chave, não nome.
 */
export function identidadeDoContato(c: ContatoIdentificavel): string | null {
  if (c.phone) return c.phone;
  if (c.wa_username) return `@${c.wa_username}`;
  if (c.instagram_username) return `@${c.instagram_username}`;
  return null;
}

/**
 * A ficha pode ficar SEM telefone? Só quando tem outra identidade que o CHECK
 * de `contacts` aceita (1041): o Instagram (`instagram_id`, 989) ou o BSUID do
 * WhatsApp (`wa_user_id`). Sem nenhuma das duas, apagar o telefone deixaria a
 * ficha sem identidade, e o banco recusaria o UPDATE (23514). As duas telas
 * que editam o telefone (a ficha e o formulário) perguntam aqui.
 */
export function podeFicarSemTelefone(
  c: { instagram_id?: string | null; wa_user_id?: string | null } | null | undefined
): boolean {
  return !!c?.instagram_id || !!c?.wa_user_id;
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
