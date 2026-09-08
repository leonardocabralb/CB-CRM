// ============================================================
// Contrato do log dos webhooks de entrada — compartilhado pela rota e
// pela tela.
//
// Mora fora do `route.ts` por razão mecânica: um arquivo de rota do Next
// só pode exportar handlers e config. É o mesmo papel do
// `src/lib/calendly/log.ts`.
// ============================================================

/** Página do log. */
export const EVENTOS_POR_PAGINA = 20;

/**
 * Em que estados "Processar de novo" é seguro.
 *
 * Fora ficam, cada um por um motivo:
 * - `disparado` e `em_espera` já rodaram a automação; repetir mandaria a
 *   mesma mensagem ao cliente outra vez.
 * - `falhou` não diz ONDE parou — o passo de envio pode ter saído antes do
 *   erro. Quem quiser retomar usa o histórico da automação.
 * - `sem_telefone` daria o mesmo resultado: o payload gravado é o mesmo, e
 *   sem telefone não há sobre quem agir. O caminho é arrumar o
 *   `campo_telefone` do webhook e mandar um acionamento novo.
 * - `ignorado` é webhook desligado; ligar e reprocessar mandaria mensagem
 *   sobre um lead de dias atrás.
 *
 * ⚠️ A TELA importa esta constante para decidir se mostra o botão. Não
 * duplicar a lista: rota e tela divergiriam na primeira mudança.
 */
export const RESULTADOS_REPROCESSAVEIS = [
  "recebido",
  "sem_contato",
  "sem_automacao",
] as const;

/**
 * Colunas do log que saem para a tela. `variaveis` ENTRA (é o que responde
 * "por que {{vars.nome}} saiu vazio"); `processando_desde` e `account_id`
 * ficam de fora — são mecânica interna.
 */
export const COLUNAS_DO_EVENTO =
  "id, webhook_id, id_externo, nome, telefone, variaveis, contact_id, resultado, detalhe, recebido_em, processado_em";
