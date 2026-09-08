/**
 * O log de recebimentos do cartão (977): tamanho da página e as colunas
 * que as duas rotas devolvem. Fora das rotas de propósito — um `route.ts`
 * só pode exportar handlers e config do Next.
 */

/** Pedido do operador: só os últimos 20 por vez, paginado. */
export const EVENTOS_POR_PAGINA = 20;

/**
 * Resultados em que "processar de novo" é seguro. Os de fora não estão
 * bloqueados por conservadorismo:
 *   - `disparado` e `em_espera`: a automação JÁ rodou (ou está rodando).
 *     Repetir mandaria a mesma mensagem ao cliente/à equipe outra vez e
 *     mexeria no card de novo.
 *   - `falhou`: não se sabe ONDE parou. Se foi depois do passo que envia,
 *     repetir duplica a mensagem. O caminho certo aí é o histórico da
 *     automação (diz o passo) e o "Executar automação" da conversa (955).
 *   - `sem_telefone`: o telefone não veio no payload do Calendly; repetir
 *     dá exatamente o mesmo.
 */
export const RESULTADOS_REPROCESSAVEIS = ["recebido", "sem_contato", "sem_automacao"] as const;

export const COLUNAS_DO_EVENTO =
  "id, evento, nome, email, telefone, telefone_origem, event_type_nome, inicio, fim, link, perguntas, contact_id, resultado, detalhe, recebido_em, processado_em";
