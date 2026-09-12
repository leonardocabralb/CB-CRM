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

import type { CbChannel } from '@/lib/cb-channels/repo';
import { ehMeta } from '@/lib/cb-channels/transporte';

/** O mínimo que a regra precisa de uma mensagem. */
export interface MensagemDaJanela {
  sender_type: string;
  created_at: string;
  /** Conexão por onde a mensagem passou (`messages.channel_id`, 902). Nulo =
   *  sem carimbo. */
  channel_id?: string | null;
  /** Id do provedor (`messages.message_id`). O da API oficial da Meta começa
   *  com `wamid.` — é o que identifica a mensagem da Meta sem carimbo. */
  message_id?: string | null;
}

/** O número por onde se vai responder: o `id` casa o carimbo; o `kind`
 *  decide o que fazer com a mensagem sem carimbo. */
export type CanalDeSaida = Pick<CbChannel, 'id' | 'kind'>;

export const HORAS_DA_JANELA = 24;
export const MINUTOS_DA_JANELA = HORAS_DA_JANELA * 60;

/** O prefixo do id de provedor da API oficial da Meta. A 991 repete o
 *  literal no SQL do gatilho — há teste cobrando os dois. */
export const PREFIXO_DO_ID_DA_META = 'wamid.';

/** Mensagem da API oficial da Meta: o id do provedor é um `wamid.`. Nem a
 *  Evolution (ids hexadecimais do Baileys) nem o Instagram usam o prefixo. */
function veioPelaApiDaMeta(m: MensagemDaJanela): boolean {
  return typeof m.message_id === 'string' && m.message_id.startsWith(PREFIXO_DO_ID_DA_META);
}

/**
 * A mensagem do cliente CONTA para a janela deste número de saída?
 *
 * - Carimbada: só se o carimbo for o do número de saída.
 * - ⚠️ SEM carimbo é AMBÍGUA, e a regra decide pela PROCEDÊNCIA:
 *   - veio pela API da Meta (`wamid.`) e a saída é um número Meta → CONTA.
 *     É o carimbo que faltou: até 10/09/2026 ele era um UPDATE separado que
 *     engolia a falha (hoje vai no próprio insert, mas o canal ainda resolve
 *     nulo quando a consulta de `cb_channels` falha), ou é histórico de antes
 *     do multi-canal, quando o número oficial era o único da conta. Não
 *     contar trancava o compositor sobre um cliente que acabou de escrever —
 *     e compositor trancado não tem saída na tela (achado do Codex no PR #192).
 *   - qualquer outra (id da Evolution, ou saída que não é Meta) → NÃO conta.
 *     Mensagem da Evolution sem carimbo numa conversa mista é justamente o
 *     caso que a Meta recusa.
 *   O resíduo aceito: numa conta com DOIS números oficiais, a mensagem da
 *   Meta sem carimbo é atribuída ao número de saída. É raro — depende de uma
 *   falha, ou de uma conexão oficial APAGADA (o `ON DELETE SET NULL` da 902
 *   anula o carimbo das mensagens dela) — e o erro cai do lado da falha
 *   VISÍVEL (a Meta recusa e a bolha fica em falha), nunca do compositor
 *   trancado. Antes da regra por número, esse caso já contava do mesmo jeito.
 * - `canalDeSaida` nulo: número de saída DESCONHECIDO, e isso só acontece na
 *   conta sem conexão nenhuma (o legado de número único). Ali toda mensagem
 *   do cliente conta, como antes do multi-canal.
 */
function contaParaOCanal(
  m: MensagemDaJanela,
  canalDeSaida: CanalDeSaida | null
): boolean {
  if (canalDeSaida === null) return true;
  if (m.channel_id) return m.channel_id === canalDeSaida.id;
  return ehMeta(canalDeSaida) && veioPelaApiDaMeta(m);
}

/** A última mensagem do cliente que CONTA para a janela do número de saída. */
export function ultimaDoClienteNoCanal(
  mensagens: readonly MensagemDaJanela[],
  canalDeSaida: CanalDeSaida | null
): MensagemDaJanela | undefined {
  for (let i = mensagens.length - 1; i >= 0; i--) {
    const m = mensagens[i];
    if (m.sender_type !== 'customer') continue;
    if (contaParaOCanal(m, canalDeSaida)) return m;
  }
  return undefined;
}

/**
 * Minutos que ainda restam da janela, contados da última mensagem do cliente
 * que conta para o NÚMERO DE SAÍDA. Zero quando não há mensagem dele ali ou
 * quando as 24h já passaram. Fica sempre entre 0 e 24h: relógio do aparelho
 * atrasado em relação ao carimbo da mensagem não produz "25h restantes".
 *
 * Os minutos já PASSADOS são truncados (`differenceInMinutes`), então o minuto
 * em curso ainda conta como restante: a etiqueta pode prometer até 59
 * segundos a mais. O portão não sofre disso — fechada é `restante === 0`, que
 * equivale a 24h00 exatas já passadas.
 */
export function minutosRestantes(
  mensagens: readonly MensagemDaJanela[],
  agora: Date,
  canalDeSaida: CanalDeSaida | null
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
 * ⚠️ Fio COM mensagens e NENHUMA do cliente que conte para o canal de saída
 * responde `true`: só o cliente abre a janela, e ele nunca a abriu NESTE
 * número.
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
  canalDeSaida: CanalDeSaida | null
): boolean {
  if (mensagens.length === 0) return false;
  return minutosRestantes(mensagens, agora, canalDeSaida) === 0;
}

/**
 * Como a etiqueta fala o que resta: horas INTEIRAS enquanto sobra pelo menos
 * uma; na última hora, minutos. As horas arredondam PARA BAIXO — a etiqueta
 * nunca promete uma hora que não há. Os minutos herdam o truncamento de
 * `minutosRestantes` (até 59 segundos a mais; ver lá).
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
