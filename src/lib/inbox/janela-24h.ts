// ============================================================
// A janela de 24 horas da Meta, num lugar só.
//
// Só a API oficial da Meta tem essa janela: passadas 24h da última mensagem
// DO CLIENTE, a conta não pode mais escrever livremente — só reabre por
// modelo. No transporte Evolution ela não existe (quem decide isso é o
// chamador, não este módulo).
//
// ⚠️ Existe como módulo porque a regra é lida em DOIS momentos com relógios
// diferentes: no render (para a etiqueta do cabeçalho e para travar o
// compositor) e no INSTANTE DO DISPARO (o último portão antes da rede, depois
// dos 5s da janela de desfazer e do tempo que um rascunho de mídia fica
// aberto). Escrita duas vezes, ela divergiria — e a divergência que importa é
// justamente a do caso raro.
//
// ⚠️ A janela é POR NÚMERO. A conversa é uma por contato e mistura conexões
// (número por QR Code e número oficial no mesmo fio), mas a Meta só conta a
// mensagem que o cliente mandou AO NÚMERO OFICIAL por onde se vai responder.
// Contando o fio inteiro, o cliente que escreveu há 2h só pelo número por QR
// Code deixava a etiqueta em "22h restantes" e o compositor livre — e a Meta
// recusava o texto (erro 131047). Por isso as funções recebem o CANAL DE
// SAÍDA, e o parâmetro é obrigatório: quem chama tem de dizer por qual número
// vai responder.
// ============================================================

import { differenceInMinutes } from 'date-fns';

/** O mínimo que a regra precisa de uma mensagem. */
export interface MensagemDaJanela {
  sender_type: string;
  created_at: string;
  /** Conexão por onde a mensagem passou (`messages.channel_id`, 902). Nulo =
   *  sem carimbo: anterior ao multi-canal, ou de uma conexão já apagada. */
  channel_id?: string | null;
}

export const HORAS_DA_JANELA = 24;
const MINUTOS_DA_JANELA = HORAS_DA_JANELA * 60;

/**
 * A última mensagem do cliente que CONTA para a janela do número de saída.
 *
 * - `canalDeSaida` preenchido: só a carimbada com ESTE canal. ⚠️ Mensagem SEM
 *   carimbo não conta: ela é anterior ao multi-canal ou veio de uma conexão
 *   apagada — nos dois casos, não de um número que existe hoje —, e
 *   atribuí-la ao número de saída seria inventar (a mesma regra do separador
 *   de canal do fio, no CLAUDE.md).
 * - `canalDeSaida` nulo: o número de saída é DESCONHECIDO, e isso só acontece
 *   na conta sem conexão nenhuma — o legado de número único. Ali toda
 *   mensagem do cliente conta, como antes do multi-canal.
 */
export function ultimaDoClienteNoCanal(
  mensagens: readonly MensagemDaJanela[],
  canalDeSaida: string | null
): MensagemDaJanela | undefined {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m.sender_type !== 'customer') continue;
    if (canalDeSaida !== null && m.channel_id !== canalDeSaida) continue;
    return m;
  }
  return undefined;
}

/**
 * Minutos que ainda restam da janela, contados da última mensagem do cliente
 * NO CANAL DE SAÍDA. Zero quando não há mensagem dele ali ou quando as 24h já
 * passaram. Fica sempre entre 0 e 24h: relógio do aparelho atrasado em
 * relação ao carimbo da mensagem não produz "25h restantes".
 */
export function minutosRestantes(
  mensagens: readonly MensagemDaJanela[],
  agora: Date,
  canalDeSaida: string | null
): number {
  const ultima = ultimaDoClienteNoCanal(mensagens, canalDeSaida);
  if (!ultima) return 0;
  const passados = differenceInMinutes(agora, new Date(ultima.created_at));
  return Math.min(MINUTOS_DA_JANELA, Math.max(0, MINUTOS_DA_JANELA - passados));
}

/**
 * A janela está FECHADA neste instante, para o número de saída?
 *
 * ⚠️ Fio VAZIO responde `false`, e isso é load-bearing: é a conversa que o
 * próprio CRM acabou de abrir (PR #79), que ainda não tem mensagem nenhuma.
 * Respondendo "fechada" ali, a primeira mensagem de toda conversa iniciada
 * por nós seria barrada — a feature inteira. "Vazio" é o FIO inteiro, nunca o
 * recorte do canal: fio com mensagens por outro número e nenhuma do cliente
 * no de saída é justamente o caso que a Meta recusa.
 *
 * ⚠️ Fio COM mensagens e NENHUMA do cliente no canal de saída responde
 * `true`: só o cliente abre a janela, e ele nunca a abriu NESTE número.
 *
 * Fechada é o mesmo que "não resta nenhum minuto" — a etiqueta e o portão
 * nunca discordam sobre o instante da virada.
 *
 * @param agora Injetado pelo chamador — o render passa o relógio da badge, o
 *   disparo passa a hora DELE, e o teste passa uma hora fixa.
 * @param canalDeSaida Obrigatório de propósito (ver o cabeçalho).
 */
export function janelaFechada(
  mensagens: readonly MensagemDaJanela[],
  agora: Date,
  canalDeSaida: string | null
): boolean {
  if (mensagens.length === 0) return false;
  return minutosRestantes(mensagens, agora, canalDeSaida) === 0;
}

/**
 * Como a etiqueta fala o que resta: horas INTEIRAS enquanto sobra pelo menos
 * uma; na última hora, minutos. Arredonda sempre PARA BAIXO — a etiqueta nunca
 * promete tempo que não há.
 *
 * ⚠️ Antes desta função o cálculo era em horas inteiras e o ramo de minutos
 * do cabeçalho nunca rodava: a última hora aparecia inteira como "1h
 * restantes" e pulava direto para "Expirada" — justamente quando o minuto
 * importa.
 */
export function restanteParaExibir(minutos: number): {
  unidade: 'h' | 'min';
  valor: number;
} {
  if (minutos >= 60) return { unidade: 'h', valor: Math.floor(minutos / 60) };
  return { unidade: 'min', valor: Math.max(0, Math.floor(minutos)) };
}
