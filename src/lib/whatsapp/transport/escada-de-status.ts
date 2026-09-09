// ============================================================
// Escada de status de entrega da mensagem que NÓS enviamos.
//
// A Evolution 2.4 (Baileys 7) emite VÁRIOS `messages.update` para a mesma
// mensagem — e fora de ordem. Medido em 09/09/2026, no primeiro texto que o
// CRM enviou depois do upgrade: `SERVER_ACK` às 19:19:12.089, `DELIVERY_ACK`
// às 19:19:12.241 e um NOVO `SERVER_ACK` às 19:19:21.531 (e outro às
// 19:19:51 nas três mensagens seguintes). Aplicado sem guarda, o último
// rebaixava `delivered` para `sent`, e a bolha voltava a UM ✓ com a mensagem
// entregue há segundos — foi assim que o operador viu "no CRM só tem 1 check"
// enquanto o WhatsApp do escritório mostrava ✓✓. A Baileys 6.7.19 raramente
// fazia isso, e o comentário da rota dizia que a escada "já era monotônica
// na prática". Não é mais. Ver docs/PLANO-baileys-7.md, ajuste 6.
// ============================================================

/** Os valores do CHECK de `messages.status` (001). */
export type StatusDeEntrega = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Os status que um recibo pode ANUNCIAR como avanço; `failed` tem regra própria. */
export type StatusDeAvanco = 'sent' | 'delivered' | 'read';

const DEGRAU: Record<Exclude<StatusDeEntrega, 'failed'>, number> = {
  sending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Os status a partir dos quais chegar a `novo` é um AVANÇO — a lista que o
 * UPDATE da rota põe em `.in('status', …)`. Um recibo atrasado ou repetido
 * não acha linha nenhuma para rebaixar. `failed` fica de fora de propósito:
 * quem decide se uma falha é crível é `ACEITA_FALHA`, na rota.
 */
export function aceitamAvancoPara(novo: StatusDeAvanco): StatusDeEntrega[] {
  return (Object.keys(DEGRAU) as Exclude<StatusDeEntrega, 'failed'>[]).filter(
    (s) => DEGRAU[s] < DEGRAU[novo],
  );
}

/** Aplica a escada a uma sequência de recibos, na ordem em que chegaram. */
export function aplicarRecibos(
  inicial: StatusDeEntrega,
  recibos: StatusDeAvanco[],
): StatusDeEntrega {
  let atual = inicial;
  for (const r of recibos) {
    if (aceitamAvancoPara(r).includes(atual)) atual = r;
  }
  return atual;
}
