// ============================================================
// Mensagem nossa que o WhatsApp do cliente NÃO confirmou (23/09/2026).
//
// Pedido do operador depois de um link de reunião que não chegou ao cliente:
// "o operador sequer tem como identificar visualmente que teve um erro". O
// balão vermelho já existia para `status = 'failed'` — o WhatsApp devolveu
// erro —, mas a falha que mais mordeu não devolve erro NENHUM: a mensagem
// fica em "enviada" (✓) para sempre, igual a qualquer mensagem nos primeiros
// segundos. Medido: das 4 falhas reais desde 11/09, só uma virou `failed`
// (recibo ERROR); as outras 3 ficaram em ✓.
//
// Não existe recibo de "não entregue". O que existe é EVIDÊNCIA de que o
// aparelho do cliente estava no ar depois da mensagem e mesmo assim não a
// confirmou:
//   • uma mensagem NOSSA posterior, na mesma conversa, já foi entregue ou
//     lida; ou
//   • o CLIENTE escreveu mais de um minuto depois dela.
// Com um minuto de espera pelo recibo, a regra marcou exatamente as 3 falhas
// reais nas 152 mensagens enviadas pelo CRM pela Evolution desde 11/09, e
// nenhuma outra.
//
// ⚠️ Cada recorte abaixo evita um alarme falso MEDIDO — não afrouxar sem
// medir de novo:
//   • só conexão da EVOLUTION (revisão do PR #272). O Instagram nem manda
//     recibo de entrega: lá ✓ parado não prova nada. A rota da Meta gravava a
//     situação SEM a escada de `escada-de-status.ts` até 23/09/2026 — um
//     "sent" atrasado rebaixava "delivered" — e não esperava a mensagem
//     existir para aplicar o recibo. Ganhou as duas nesse dia, mas as
//     mensagens gravadas ANTES continuam com a situação que o defeito deixou:
//     alargar para a Meta pede medir de novo os falsos positivos, com corte
//     no deploy do conserto, e a decisão do operador. A Meta avisa a recusa
//     de verdade com `failed`, que já tem o seu vermelho;
//   • só o que saiu PELO CRM (atendente, agendada, API, automação, robô). A
//     mensagem do CELULAR pareado às vezes tem o recibo perdido pelo CRM (em
//     23/09 uma foi gravada 38 s depois do recibo de "lida", além da espera
//     de ~30 s da rota do webhook), e o próprio celular já mostra a quem
//     mandou o estado real;
//   • só a partir de 11/09/2026, 00:00 UTC — ver `RECIBOS_CONFIAVEIS_DESDE_MS`.
//     Antes disso o CRM perdia recibo de mensagem que CHEGOU, e 27 mensagens
//     antigas ficariam vermelhas sem motivo;
//   • grupo fica de fora: lá o recibo é por participante, e "o cliente" não
//     existe.
//
// ⚠️ Sem evidência, não acusa: mensagem única, cliente calado e nenhuma
// outra nossa depois = continua em ✓. Daqui não há como separar "não chegou"
// de "celular desligado".
// ============================================================

import type { Message } from "@/types";

/**
 * A partir de quando a situação gravada merece confiança. São dois motivos,
 * os dois no mesmo dia:
 *   • o deploy do PR #191 (10/09/2026, 10:44 BRT), o recibo que chega antes
 *     da mensagem — antes dele, recibo perdido era rotina;
 *   • a montagem da conexão oficial da Meta, na tarde de 10/09: as duas
 *     primeiras mensagens saíram antes de o webhook de status existir e
 *     ficaram em ✓ para sempre. Com o corte no fim do deploy, elas acendiam
 *     o vermelho na conversa de teste (visto na tela em 23/09).
 * Nenhuma falha real ficou em ✓ na janela entre os dois (medido).
 */
export const RECIBOS_CONFIAVEIS_DESDE_MS = Date.parse("2026-09-11T00:00:00Z");

/**
 * Quanto a mensagem espera pelo próprio recibo antes de poder ser acusada.
 * O recibo chega em segundos; o minuto é folga para o que chega atrasado
 * (a rota do webhook ainda tenta aplicá-lo por ~30 s).
 */
export const ESPERA_PELO_RECIBO_MS = 60_000;

/**
 * "O cliente escreveu depois" só prova que o aparelho dele estava no ar
 * DEPOIS de a nossa ter tido tempo de chegar. A mensagem que ele mandou
 * segundos depois da nossa pode ter saído de um celular que caiu da rede em
 * seguida — daí um minuto de folga. (O carimbo é do servidor do WhatsApp,
 * não do relógio do aparelho.)
 */
export const FOLGA_DO_CLIENTE_MS = 60_000;

type MensagemDoFio = Pick<
  Message,
  | "id"
  | "sender_type"
  | "from_device"
  | "status"
  | "created_at"
  | "deleted_at"
  | "delete_requested_at"
  | "channel_id"
>;

/**
 * Os ids das mensagens nossas que o cliente provavelmente não recebeu.
 *
 * As duas opções são OBRIGATÓRIAS de propósito — o compilador cobra de quem
 * montar isto numa tela nova:
 *   • `emGrupo`: esquecer de dizer que o fio é de grupo pintaria de vermelho
 *     mensagens cujo recibo tem outra natureza;
 *   • `canaisEvolution`: os ids das conexões Evolution da conta. Mensagem de
 *     outra conexão (ou sem carimbo) nunca é candidata. Lista vazia — os
 *     canais ainda carregando — não acusa nada, que é o lado seguro.
 * A EVIDÊNCIA, ao contrário, vale de qualquer conexão: uma mensagem entregue
 * pela Meta prova que o aparelho da pessoa estava no ar.
 */
export function entregasNaoConfirmadas(
  mensagens: readonly MensagemDoFio[],
  agoraMs: number,
  {
    emGrupo,
    canaisEvolution,
  }: { emGrupo: boolean; canaisEvolution: ReadonlySet<string> },
): Set<string> {
  const marcadas = new Set<string>();
  if (emGrupo) return marcadas;

  // "Existe uma posterior" é o mesmo que "a mais recente é posterior": basta
  // o instante mais novo de cada evidência.
  let ultimaNossaConfirmada = -Infinity;
  let ultimaDoCliente = -Infinity;
  for (const m of mensagens) {
    const t = Date.parse(m.created_at);
    if (Number.isNaN(t)) continue;
    // ⚠️ O cliente vem PRIMEIRO: a mensagem dele também é gravada com
    // `status = 'delivered'`, e contá-la como "nossa confirmada" acusaria
    // tudo o que mandamos antes de qualquer fala dele.
    if (m.sender_type === "customer") {
      ultimaDoCliente = Math.max(ultimaDoCliente, t);
    } else if (m.status === "delivered" || m.status === "read") {
      ultimaNossaConfirmada = Math.max(ultimaNossaConfirmada, t);
    }
  }

  for (const m of mensagens) {
    if (m.sender_type === "customer" || m.from_device) continue;
    if (!m.channel_id || !canaisEvolution.has(m.channel_id)) continue;
    if (m.status !== "sent") continue;
    if (m.deleted_at || m.delete_requested_at) continue;
    const t = Date.parse(m.created_at);
    if (Number.isNaN(t) || t < RECIBOS_CONFIAVEIS_DESDE_MS) continue;
    if (agoraMs - t < ESPERA_PELO_RECIBO_MS) continue;
    if (ultimaNossaConfirmada > t || ultimaDoCliente > t + FOLGA_DO_CLIENTE_MS) {
      marcadas.add(m.id);
    }
  }
  return marcadas;
}
