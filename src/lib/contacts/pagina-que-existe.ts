// ============================================================
// A página da tabela de Contatos que ainda EXISTE, depois de a pedida voltar
// vazia. Porte do #679 do original (`page-bounds.ts`), adaptado.
//
// Mover para a Lixeira as fichas da última página — ou outro membro apagar
// fichas com a página aberta — deixa a tela pedindo uma página além do fim. O
// PostgREST responde de dois jeitos: com a página exatamente no fim, lista
// vazia e a contagem certa ("Nenhum contato ainda" com "Página 3 de 2");
// além dele, 416 `PGRST103`, sem contagem nenhuma ("Falha ao carregar" com as
// fichas já movidas na tela). O filtro por etiqueta (RPC 025) só traz o total
// junto com as linhas: página vazia ali também não diz quantas há.
// ============================================================

/**
 * Para onde a tabela vai quando a `pagina` pedida (a partir de 0) voltou
 * VAZIA.
 *
 * - `total` conhecido: a última página que existe (0 com a lista vazia).
 * - `total` desconhecido (`null`): uma página para trás — quem chama pede de
 *   novo e, se ainda passar do fim, volta mais uma.
 * - A página 0 é sempre válida: o vazio ali é "nenhum contato" de verdade.
 *
 * ⚠️ Devolver a própria `pagina` quer dizer "fique e mostre o vazio" (a
 * contagem diz que a página existe, e a lista veio vazia mesmo assim — uma
 * corrida). Quem chama só pede de novo quando o destino é OUTRO: é isso que
 * impede o laço.
 */
export function paginaQueExiste(
  pagina: number,
  total: number | null,
  porPagina: number,
): number {
  if (pagina <= 0) return 0;
  if (total === null) return pagina - 1;
  const ultima = Math.max(0, Math.ceil(total / porPagina) - 1);
  return Math.min(pagina, ultima);
}
