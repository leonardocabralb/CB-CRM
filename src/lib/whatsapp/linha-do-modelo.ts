/**
 * Qual linha local de `message_templates` é "o modelo" de um canal — a régua
 * da submissão (`templates/submit`) e da sincronização (`templates/sync`),
 * que têm de escolher a MESMA linha.
 *
 * Na conta podem conviver, com o mesmo nome e idioma, a linha do canal e a
 * global (`channel_id` nulo, de antes da 903 — ou o homônimo que a busca por
 * autor deixava nascer). Vale só a do canal pedido ou a global; entre elas, a
 * do canal, depois a vinculada à Meta (`meta_template_id`), depois a primeira
 * da lista (quem chama ordena por `created_at`, a mais antiga primeiro).
 *
 * ⚠️ Lista, nunca `.maybeSingle()`: com as duas linhas o PostgREST responde
 * "várias linhas" e a sincronização daquele modelo falhava para sempre. E o
 * recorte do canal é feito aqui, não num `.or()`: no ensaio da submissão o
 * canal vem do corpo do pedido, e texto de fora não entra num filtro.
 */
export interface LinhaDoModelo {
  id: string
  channel_id: string | null
  meta_template_id: string | null
}

export function escolherLinhaDoModelo<T extends LinhaDoModelo>(
  linhas: readonly T[],
  channelId: string | null,
): T | null {
  const pontos = (l: T) =>
    (l.channel_id === channelId ? 2 : 0) + (l.meta_template_id ? 1 : 0)
  let melhor: T | null = null
  for (const l of linhas) {
    if (l.channel_id !== channelId && l.channel_id !== null) continue
    if (!melhor || pontos(l) > pontos(melhor)) melhor = l
  }
  return melhor
}
