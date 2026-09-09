/**
 * A janela que cada sincronização pede ao tl;dv — puro.
 *
 * - Primeira vez: os últimos 30 dias, para a ficha nascer com histórico.
 * - Depois: os últimos 7 dias, sempre. Não é "desde a última sincronização"
 *   porque o tl;dv processa a gravação DEPOIS da reunião (às vezes horas), e
 *   `happenedAt` é a hora da reunião, não a do processamento: uma janela
 *   colada no último ciclo perderia a reunião de ontem à noite que só ficou
 *   pronta hoje. Sete dias custam uma página (100 por página) e cobrem o
 *   fim de semana. A idempotência é o UNIQUE da 987; repetir não duplica.
 */

export const JANELA_PRIMEIRA_DIAS = 30;
export const JANELA_DIAS = 7;
const DIA_MS = 24 * 60 * 60 * 1000;

export function janelaDeSync(agora: Date, primeira: boolean): { de: Date; ate: Date; dias: number } {
  const dias = primeira ? JANELA_PRIMEIRA_DIAS : JANELA_DIAS;
  return { de: new Date(agora.getTime() - dias * DIA_MS), ate: agora, dias };
}
