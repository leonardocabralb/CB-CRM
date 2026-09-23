// ============================================================
// Mensagem nossa que o WhatsApp do cliente NÃO confirmou (23/09/2026).
//
// Pedido do operador depois de um link de reunião que não chegou ao cliente:
// "o operador sequer tem como identificar visualmente que teve um erro". O
// balão vermelho já existia para `status = 'failed'` — o WhatsApp devolveu
// erro —, mas a falha que mordeu não devolve erro NENHUM: a mensagem fica em
// "enviada" (✓) para sempre, igual a qualquer mensagem nos primeiros
// segundos. Medido: das 3 falhas reais desde 10/09, nenhuma virou `failed`.
//
// Não existe recibo de "não entregue". O que existe é EVIDÊNCIA de que o
// aparelho do cliente estava no ar depois da mensagem e mesmo assim não a
// confirmou:
//   • uma mensagem NOSSA posterior, na mesma conversa, já foi entregue ou
//     lida; ou
//   • o CLIENTE escreveu mais de um minuto depois dela.
// Com um minuto de espera pelo recibo, a regra marcou exatamente as 3 falhas
// reais nas 153 mensagens enviadas pelo CRM desde 11/09 (Evolution e Meta),
// e nenhuma outra.
//
// ⚠️ Cada recorte abaixo evita um alarme falso MEDIDO — não afrouxar sem
// medir de novo:
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
 * A mensagem do cliente é carimbada pelo relógio do aparelho DELE. Um minuto
 * de folga impede que um relógio adiantado transforme a resposta que ele deu
 * junto com a nossa em "escreveu depois".
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
>;

/**
 * Os ids das mensagens nossas que o cliente provavelmente não recebeu.
 *
 * `emGrupo` é OBRIGATÓRIO de propósito: esquecer de dizer que o fio é de
 * grupo pintaria de vermelho mensagens cujo recibo tem outra natureza.
 */
export function entregasNaoConfirmadas(
  mensagens: readonly MensagemDoFio[],
  agoraMs: number,
  { emGrupo }: { emGrupo: boolean },
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
