/**
 * O vocabulário do log do ZapSign (1057): o que cada entrega virou, por onde
 * o cliente foi achado, e as colunas que as rotas devolvem. Fora das rotas de
 * propósito — um `route.ts` só pode exportar handlers e config do Next.
 *
 * ⚠️ `RESULTADOS_DO_EVENTO` e `CASADO_POR` são ESPELHO dos CHECKs da 1057.
 * Valor novo aqui sem migration faz a gravação do resultado levar 23514 — o
 * Supabase não lança, e a linha ficaria `recebido` para sempre. Há teste
 * lendo o SQL (`supabase/migrations/zapsign-1057.test.ts`).
 */

export const RESULTADOS_DO_EVENTO = [
  "recebido",
  /** alguma automação rodou até o fim sem falha */
  "disparado",
  /** parou num "Aguardar"; o resto fica no histórico da automação */
  "em_espera",
  /** nenhum cliente casou (ou dois casaram): o operador arruma a ficha e processa de novo */
  "sem_contato",
  "sem_automacao",
  "falhou",
  /** outro evento, documento apagado, ou o disparo já saiu por outra assinatura */
  "ignorado",
  /** ainda falta alguém assinar — a próxima assinatura completa o documento */
  "incompleto",
] as const;

export type ResultadoDoEvento = (typeof RESULTADOS_DO_EVENTO)[number];

export const CASADO_POR = ["external_id", "documento", "telefone", "email", "cpf"] as const;

export type CasadoPor = (typeof CASADO_POR)[number];

/**
 * Resultados em que "Processar de novo" é seguro — nada da automação rodou:
 *   - `recebido`: o processamento não chegou ao fim (a releitura no ZapSign
 *     falhou, ou o processo morreu antes);
 *   - `sem_contato`: o operador arrumou a ficha (telefone, e-mail, CPF);
 *   - `incompleto`: faltava assinatura; se o documento já está completo, o
 *     cadeado do DISPARO (`cb_zapsign_documentos.disparo_evento_id`) impede
 *     que ele saia duas vezes;
 *   - `sem_automacao`: a automação ainda não existia ou estava desligada.
 * Os de fora não estão bloqueados por conservadorismo: `disparado` e
 * `em_espera` já rodaram (repetir moveria o card de novo e mandaria a mesma
 * mensagem), e em `falhou` não se sabe onde parou.
 */
export const RESULTADOS_REPROCESSAVEIS = ["recebido", "sem_contato", "incompleto", "sem_automacao"] as const;

/** 20 por página, como o log do Calendly. */
export const EVENTOS_POR_PAGINA = 20;

/** Sem `variaveis`: o log mostra o resultado, não o conteúdo do contrato. */
export const COLUNAS_DO_EVENTO =
  "id, doc_token, event_type, documento_nome, signatario_nome, resultado, casado_por, contact_id, deal_id, detalhe, recebido_em, processado_em";
