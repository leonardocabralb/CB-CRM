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

/** Data de hoje no formato do `<input type="date">`, em horário local. */
export function hojeParaInput(agora: Date = new Date()): string {
  const mm = String(agora.getMonth() + 1).padStart(2, '0');
  const dd = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mm}-${dd}`;
}

/** Hora atual no formato do `<input type="time">`, em horário local. */
export function horaParaInput(agora: Date = new Date()): string {
  const hh = String(agora.getHours()).padStart(2, '0');
  const mi = String(agora.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

/**
 * De quanto em quanto tempo o agendador acorda, em minutos — e, por
 * consequência, a grade em que a tela deixa escolher a hora.
 *
 * ⚠️ Os dois números são O MESMO por decisão do operador: verificar de minuto
 * em minuto é carga de servidor que não compra nada para um escritório, e
 * oferecer um horário mais fino que o ciclo é prometer o que não se cumpre. A
 * tela arredonda para a grade e diz, em palavras, o atraso máximo.
 *
 * ⚠️ Mudar aqui NÃO muda o agendador: o intervalo real está no `sleep` do
 * serviço `agendador` em `docker-stack.yml`. Os dois têm de andar juntos, e é
 * por isso que o número mora numa constante com este aviso.
 */
export const CICLO_MINUTOS = 15;

/**
 * Sobe a data para o próximo ponto da grade de 15 minutos.
 *
 * Sempre para CIMA: descer poria a hora no passado em relação ao que a pessoa
 * pediu, e "adiantar" mensagem para cliente é pior que atrasar.
 */
export function arredondarParaGrade(
  d: Date,
  minutos: number = CICLO_MINUTOS,
): Date {
  const r = new Date(d.getTime());
  r.setSeconds(0, 0);
  const resto = r.getMinutes() % minutos;
  if (resto !== 0) r.setMinutes(r.getMinutes() + (minutos - resto));
  return r;
}

/**
 * Atalhos do seletor, em horas. "Daqui a 24h", "daqui a 7 dias".
 *
 * ⚠️ Em HORAS, e não somando dias no calendário. No Brasil dá no mesmo — o
 * horário de verão acabou em 2019 —, e horas têm uma propriedade que dias
 * não têm: "daqui a 24 horas" é sempre 24 horas. Somando dias, uma virada de
 * fuso faria "7 dias" chegar uma hora antes ou depois do combinado, e uma
 * mensagem de escritório marcada para as 9h sairia às 8h.
 */
export const ATALHOS_DE_PRAZO = [
  { chave: 'h24', horas: 24 },
  { chave: 'h72', horas: 72 },
  { chave: 'd7', horas: 24 * 7 },
  { chave: 'd15', horas: 24 * 15 },
  { chave: 'd30', horas: 24 * 30 },
] as const;

export type ChaveDeAtalho = (typeof ATALHOS_DE_PRAZO)[number]['chave'];

/**
 * Daqui a N horas, já partido nas duas strings que os campos nativos usam.
 *
 * Passa pelos componentes LOCAIS (`getHours`, `getDate`) de propósito: é a
 * mesma regra do `comporHorario`, e é o que impede o valor de voltar para a
 * tela deslocado pelo fuso.
 */
export function daquiAHoras(
  horas: number,
  agora: Date = new Date(),
): { data: string; hora: string } {
  // Arredondado para a grade: o campo de hora só oferece :00/:15/:30/:45, e um
  // atalho que preenchesse 21:37 deixaria o campo com um valor que a própria
  // tela não deixa digitar.
  const alvo = arredondarParaGrade(new Date(agora.getTime() + horas * 60 * 60 * 1000));
  return { data: hojeParaInput(alvo), hora: horaParaInput(alvo) };
}

/**
 * A agendada ainda espera a hora dela? É o que separa a fila do acervo na
 * tela, e o que decide se o laço de atualização continua rodando.
 */
export function estaNaFila(status: ScheduledMessageStatus): boolean {
  return status === 'pending' || status === 'sending';
}

/**
 * Dá para mandar agora (botão "Executar" / "Tentar de novo")?
 *
 * Duas exclusões, pelo MESMO motivo — a mensagem pode já ter chegado ao
 * cliente, e um clique mandaria de novo:
 *
 * - `sending`: o worker reivindicou a linha e não devolveu; o processo morreu
 *   no meio do envio.
 * - `entrega_incerta` (926): o envio estourou DEPOIS de o WhatsApp aceitar —
 *   gravação no banco falhando, ou tempo esgotado na Evolution, que não
 *   cancela o envio já em curso.
 *
 * Nos dois casos a saída é humana: olhar a conversa e decidir.
 */
export function podeDispararAgora(
  agendada: Pick<ScheduledMessage, 'status' | 'entrega_incerta'>,
): boolean {
  if (agendada.entrega_incerta) return false;
  return agendada.status === 'pending' || agendada.status === 'failed';
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
 * Folga antes de acusar atraso numa linha. Dois ciclos mais um respiro — o
 * mesmo critério do indicador do cabeçalho.
 *
 * ⚠️ Mora aqui, e não em `saude.ts`, para não criar dependência circular:
 * `saude.ts` já importa deste arquivo.
 */
export const TOLERANCIA_ATRASO_MS = (CICLO_MINUTOS * 2 + 5) * 60_000;

/**
 * Passou da hora e ninguém mandou? Enquanto isso for verdade, o agendador
 * não está rodando — e é a única pista que o operador tem disso.
 *
 * ⚠️ Vale mais que parece: sem ela, um agendador desligado é invisível. As
 * linhas ficam eternamente "Agendada para as 9h", e a mensagem nunca sai. É
 * exatamente o que aconteceu com o cron das automações neste projeto, onde
 * ninguém percebeu por semanas.
 *
 * ⚠️ MAS COM TOLERÂNCIA, e isso é metade da função. O ciclo é de 15 minutos e
 * não anda alinhado ao relógio de parede, então TODA agendada saudável passa
 * alguns minutos com a hora vencida. Sem folga, o aviso "o agendador pode
 * estar fora do ar" aparecia em todo agendamento, todo dia — e alarme falso
 * treina o operador a ignorar exatamente o aviso que importa. É a mesma
 * política do indicador do cabeçalho (`TOLERANCIA_MINUTOS` em `saude.ts`),
 * que aqui não tinha sido aplicada.
 */
export function estaAtrasada(
  agendada: Pick<ScheduledMessage, 'scheduled_for' | 'status'>,
  agora: Date = new Date(),
): boolean {
  if (agendada.status !== 'pending') return false;
  const atrasoMs = agora.getTime() - new Date(agendada.scheduled_for).getTime();
  return atrasoMs > TOLERANCIA_ATRASO_MS;
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
