/**
 * O log de recebimentos do cartão (977): tamanho da página e as colunas
 * que as duas rotas devolvem. Fora das rotas de propósito — um `route.ts`
 * só pode exportar handlers e config do Next.
 */

/** Pedido do operador: só os últimos 20 por vez, paginado. */
export const EVENTOS_POR_PAGINA = 20;

export const COLUNAS_DO_EVENTO =
  "id, evento, nome, email, telefone, telefone_origem, event_type_nome, inicio, fim, link, perguntas, contact_id, resultado, detalhe, recebido_em, processado_em";
