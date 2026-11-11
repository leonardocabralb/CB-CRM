/**
 * Os textos e horários PADRÃO da régua do Asaas (998), num lugar só: o
 * "Criar régua padrão" (`POST /api/cb/asaas/regua`) cria as automações com
 * eles, e a tela "Cobrança automática" (1135) os usa para "Restaurar o texto
 * padrão" e para a etapa nova. Puro, sem I/O — a tela importa daqui.
 *
 * `saudacao` em vez de "Olá, {{vars.cliente_primeiro_nome}}!": empresa (CNPJ)
 * recebe só "Olá!", e o nome de pessoa sai com a inicial maiúscula. A frase
 * da situação e os links servem a uma cobrança e a várias, e os links já
 * trazem a que vence hoje junto (10/11/2026) — um "Total em aberto" depois
 * dela somaria só as vencidas (revisão do PR #494).
 *
 * Os textos se APRESENTAM ("Aqui é do…") porque, para as fichas criadas pela
 * D2, esta é a PRIMEIRA mensagem que o cliente recebe deste número, e a
 * assinatura da conta pode estar desligada; e dizem "se já pagou,
 * desconsidere" porque o boleto pago no caixa fica PENDING até compensar.
 */

export const MARCOS_PADRAO = [1, 5, 15, 30] as const;

export const TEXTO_DA_COBRANCA = [
  "{{vars.saudacao}} Aqui é do {{vars.escritorio_nome}}.",
  "Vi aqui que {{vars.cobranca_situacao}}. Ainda não identificamos o pagamento. Para pagar:",
  "{{vars.cobranca_links}}",
  "Se já pagou, pode desconsiderar esta mensagem. Qualquer dúvida, é só responder por aqui.",
].join("\n");

// O lembrete da NOITE (D12 revista, 10/11/2026): de propósito com cara de
// mensagem automática — lembra no fim do dia sem parecer uma pessoa cobrando.
// A assinatura "Mensagem automática" vem pelo "Assinar como" da automação.
export const HORA_PADRAO_LEMBRETE_DA_NOITE = "20:00";
export const ASSINATURA_DA_NOITE = "Mensagem automática";
export const TEXTO_DO_LEMBRETE_DA_NOITE = [
  "Lembrete de pagamento: {{vars.cobranca_situacao}}.",
  "Para pagar:",
  "{{vars.cobranca_links}}",
  "Se já pagou, desconsidere esta mensagem.",
].join("\n");

export const TEXTO_DO_LEMBRETE = [
  "{{vars.saudacao}} Aqui é do {{vars.escritorio_nome}}.",
  "Passando para lembrar que {{vars.cobranca_situacao}}. Para pagar:",
  "{{vars.cobranca_links}}",
  "Se já pagou, pode desconsiderar. Qualquer dúvida, é só responder por aqui.",
].join("\n");

/** O nome da automação de cobrança de N dias ("Cobrança · 1 dia", "Cobrança · 15 dias"). */
export function nomeDaCobranca(dias: number): string {
  return `Cobrança · ${dias} dia${dias > 1 ? "s" : ""}`;
}

export const NOME_DO_LEMBRETE_DO_DIA = "Lembrete · vence hoje";
export const NOME_DO_LEMBRETE_DA_NOITE = "Lembrete · noite";

/** A anotação padrão do "Pedir ligação à equipe" (1135): as `vars` são as da cobrança que acabou de sair. */
export function textoPadraoDaLigacao(etiqueta: string): string {
  return [
    "Ligar para este cliente para combinar o pagamento.",
    "Situação: {{vars.cobranca_situacao}}. Dias de atraso da mais antiga: {{vars.dias_de_atraso_maior}}.",
    "{{vars.cobranca_detalhe}}",
    `Depois da ligação, tire a etiqueta "${etiqueta}" desta ficha.`,
  ].join("\n");
}
