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
//
// ⚠️ Vale para as DUAS rotas de recibo desde 23/09/2026. A da Meta
// (`api/whatsapp/webhook`) gravava o status cru, e a desordem lá é de outra
// origem: a Meta manda `sent` e `delivered` em POSTs separados, com
// milissegundos de diferença, e cada um roda no seu `after()`. Medido em
// 23/09 no número de teste: uma interativa recebeu dois PATCH de status com
// 39 ms de diferença e terminou em `sent` — a linha nasce `sent`, então o
// `sent` foi o último a ser gravado, por cima do outro —, e o destinatário
// respondeu por um botão DELA 13 min depois.
// ============================================================

/** Os valores do CHECK de `messages.status` (001). */
export type StatusDeEntrega = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

/** Os status que um recibo pode ANUNCIAR como avanço; `failed` tem regra própria. */
export type StatusDeAvanco = 'sent' | 'delivered' | 'read';

/** Tudo o que um recibo traduzido pode anunciar. */
export type StatusDoRecibo = StatusDeAvanco | 'failed';

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
 * quem decide se uma falha é crível é `ACEITA_FALHA`.
 */
export function aceitamAvancoPara(novo: StatusDeAvanco): StatusDeEntrega[] {
  return (Object.keys(DEGRAU) as Exclude<StatusDeEntrega, 'failed'>[]).filter(
    (s) => DEGRAU[s] < DEGRAU[novo],
  );
}

/**
 * Situações a partir das quais `failed` é crível.
 *
 * ⚠️ A escada de status é de mão única, e `failed` é um desvio terminal válido
 * só no começo dela. Uma falha que chegue DEPOIS de a mensagem ter sido
 * entregue ou lida é ruído do provedor — aplicá-la pintaria de "não entregue"
 * uma mensagem que o cliente comprovadamente leu.
 *
 * Morava dentro da rota da Evolution até 23/09/2026, e a da Meta não tinha
 * nada parecido.
 */
export const ACEITA_FALHA: readonly StatusDeEntrega[] = ['sending', 'sent'];

/**
 * A lista completa que o UPDATE de um recibo põe em `.in('status', …)`: a
 * escada para o avanço, `ACEITA_FALHA` para a falha. É a regra das duas
 * rotas — quem escrever um terceiro consumidor de recibo usa esta função, e
 * não um UPDATE solto.
 */
export function aceitamORecibo(recibo: StatusDoRecibo): readonly StatusDeEntrega[] {
  return recibo === 'failed' ? ACEITA_FALHA : aceitamAvancoPara(recibo);
}

/** Aplica a escada a uma sequência de recibos, na ordem em que chegaram. */
export function aplicarRecibos(
  inicial: StatusDeEntrega,
  recibos: StatusDoRecibo[],
): StatusDeEntrega {
  let atual = inicial;
  for (const r of recibos) {
    if (aceitamORecibo(r).includes(atual)) atual = r;
  }
  return atual;
}
