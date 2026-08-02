// ============================================================
// Funções puras da mensagem agendada (925) — o que a tela precisa decidir,
// fora da tela, onde dá para testar.
// ============================================================

import type { ScheduledMessage, ScheduledMessageStatus } from '@/types';

/**
 * Junta o que os dois campos nativos devolvem (`2026-08-05` e `14:30`) numa
 * data de verdade, em horário LOCAL.
 *
 * ⚠️ É aqui que mora a armadilha que já mordeu este projeto em
 * `expected_close_date`: `new Date('2026-08-05')` é meia-noite **UTC**, o
 * que no Brasil retrocede um dia. Montar por componentes é o único jeito que
 * não depende de o motor adivinhar o fuso.
 *
 * Devolve `null` para forma inválida — o chamador transforma em recado, não
 * em `Invalid Date` viajando para o servidor.
 */
export function comporHorario(data: string, hora: string): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data);
  const h = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!d || !h) return null;

  const ano = Number(d[1]);
  const mes = Number(d[2]);
  const dia = Number(d[3]);
  const horas = Number(h[1]);
  const minutos = Number(h[2]);

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  if (horas > 23 || minutos > 59) return null;

  const composta = new Date(ano, mes - 1, dia, horas, minutos, 0, 0);
  // 31 de fevereiro vira 3 de março em silêncio; a volta pelos componentes
  // é o que pega isso.
  if (
    composta.getFullYear() !== ano ||
    composta.getMonth() !== mes - 1 ||
    composta.getDate() !== dia
  ) {
    return null;
  }
  return composta;
}

/**
 * Lê o valor de um `<input type="datetime-local">` (`2026-08-05T14:30`).
 *
 * ⚠️ Passa por `comporHorario` de propósito, em vez de entregar a string ao
 * `new Date()`. O motor até acerta neste formato — string com hora e sem
 * fuso é local por especificação —, mas a regra vira "depende do formato
 * exato que o navegador devolveu": basta um `:00` de segundos a mais, ou um
 * valor vindo de outro lugar sem hora, para cair na regra do date-only, que
 * é UTC e no Brasil retrocede um dia. Um caminho só, testado, não tem essa
 * borda.
 */
export function comporDeInputLocal(valor: string): Date | null {
  const partes = valor.split('T');
  if (partes.length !== 2) return null;
  return comporHorario(partes[0], partes[1].slice(0, 5));
}

/** Data de hoje no formato do `<input type="date">`, em horário local. */
export function hojeParaInput(agora: Date = new Date()): string {
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const dd = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mm}-${dd}`;
}

/**
 * A agendada ainda espera a hora dela? É o que separa a fila do acervo na
 * tela, e o que decide se o laço de atualização continua rodando.
 */
export function estaNaFila(status: ScheduledMessageStatus): boolean {
  return status === 'pending' || status === 'sending';
}

/**
 * Dá para mandar agora (botão "Enviar agora" / "Tentar de novo")?
 *
 * ⚠️ `sending` fica de fora, e não é descuido: a linha travada ali é a que o
 * worker reivindicou e não devolveu — a mensagem PODE já ter saído para o
 * cliente. Ver a nota em `dispararUma`.
 */
export function podeDispararAgora(status: ScheduledMessageStatus): boolean {
  return status === 'pending' || status === 'failed';
}

/**
 * O cliente escreveu depois de a mensagem ter sido agendada (P4.4).
 *
 * A resposta muda o sentido do que vai sair: um "confirmo nosso horário de
 * amanhã" marcado ontem soa diferente se o cliente escreveu de madrugada
 * cancelando. A v1 não impede o envio — só avisa, para a pessoa decidir.
 *
 * Compara com `created_at`, não com `scheduled_for`: o que interessa é se o
 * cliente falou depois de o texto ter sido ESCRITO.
 */
export function clienteEscreveuDepois(
  agendada: Pick<ScheduledMessage, 'created_at' | 'status'>,
  ultimaEntradaEm: string | null,
): boolean {
  if (!ultimaEntradaEm) return false;
  if (!estaNaFila(agendada.status)) return false;
  return new Date(ultimaEntradaEm).getTime() > new Date(agendada.created_at).getTime();
}

/**
 * Passou da hora e ninguém mandou? Enquanto isso for verdade, o agendador
 * não está rodando — e é a única pista que o operador tem disso.
 *
 * ⚠️ Vale mais que parece: sem ela, um agendador desligado é invisível. As
 * linhas ficam eternamente "Agendada para as 9h", e a mensagem nunca sai. É
 * exatamente o que aconteceu com o cron das automações neste projeto, onde
 * ninguém percebeu por semanas.
 */
export function estaAtrasada(
  agendada: Pick<ScheduledMessage, 'scheduled_for' | 'status'>,
  agora: Date = new Date(),
): boolean {
  if (agendada.status !== 'pending') return false;
  return new Date(agendada.scheduled_for).getTime() < agora.getTime();
}

/**
 * Ordem da lista: primeiro o que ainda vai sair (a mais próxima no topo),
 * depois o acervo (a mais recente no topo).
 *
 * Uma ordenação só por `scheduled_for` enterraria a próxima a sair debaixo
 * de meses de enviadas.
 */
export function ordenarParaTela(
  lista: ScheduledMessage[],
): ScheduledMessage[] {
  return [...lista].sort((a, b) => {
    const naFilaA = estaNaFila(a.status);
    const naFilaB = estaNaFila(b.status);
    if (naFilaA !== naFilaB) return naFilaA ? -1 : 1;
    const ta = new Date(a.scheduled_for).getTime();
    const tb = new Date(b.scheduled_for).getTime();
    return naFilaA ? ta - tb : tb - ta;
  });
}
