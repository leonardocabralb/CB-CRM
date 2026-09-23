// ============================================================
// O recibo (status) da Cloud API da Meta — 23/09/2026.
//
// A rota do webhook da Meta (`api/whatsapp/webhook`) gravava o status cru em
// `messages`, sem escada e sem esperar a linha existir. Eram os três defeitos
// que a Evolution já tinha resolvido (`escada-de-status.ts`,
// `recibo-antes-da-mensagem.ts`):
//   • um `sent` gravado depois do `delivered` rebaixava a bolha para um ✓ —
//     medido na produção em 23/09 (ver `escada-de-status.ts`);
//   • um `failed` atrasado marcaria como falha o que já foi entregue ou lido;
//   • o recibo que chega ANTES de o CRM gravar a mensagem (a linha nasce
//     depois de a Meta responder ao envio) achava zero linhas e se perdia.
//
// A rota agora usa a escada e a espera das duas peças acima. Este módulo
// guarda só o que é da Meta: o vocabulário dela e quanto vale esperar.
// ============================================================

import type { StatusDoRecibo } from './escada-de-status';

/**
 * Traduz o `status` do webhook da Meta para o vocabulário da escada. Os
 * valores documentados são `sent`, `delivered`, `read`, `played` e `failed`.
 * `played` (a nota de voz foi ouvida) fica acima de "lida" e fora do CHECK
 * de `messages.status`: vale como `read`, como o PLAYED da Evolution. Valor
 * fora da lista devolve `null` — gravado cru, ele estourava o CHECK.
 */
export function reciboDaMeta(status: unknown): StatusDoRecibo | null {
  switch (status) {
    case 'sent':
      return 'sent';
    case 'delivered':
      return 'delivered';
    case 'read':
    case 'played':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * Pausas entre as tentativas quando a linha da mensagem ainda não existe: 7 s
 * ao todo, contra os 30 s da Evolution. Na Meta ninguém segura a gravação de
 * propósito (a Evolution espera 2 s no `jaGravada` e despeja lotes ao
 * reconectar): a linha nasce logo depois de a Meta responder ao envio, e o
 * primeiro recibo chega ~1,5 s depois dela (medido em 23/09).
 *
 * ⚠️ E a espera longa sairia cara: nas 24 h até 23/09, 46 das 51 mensagens
 * cujo recibo chegou a esta rota NÃO existiam no CRM (39 delas iam para
 * outros números, mandadas por outro sistema ligado ao mesmo número
 * oficial). O recibo delas espera até o fim, toda vez.
 */
export const PAUSAS_DO_RECIBO_DA_META_MS: readonly number[] = [1_000, 2_000, 4_000];

/**
 * Quanto ESTE recibo espera pela linha. Dois casos não esperam nada:
 *   • `sent`: todo envio pela Meta grava a linha já como `sent`
 *     (`send-message.ts`, `flows/meta-send.ts` e `automations/meta-send.ts`
 *     — há pino no teste), então esse recibo nunca tem o que avançar;
 *   • o recibo de DISPARO (campanha): `broadcast-core.ts` escreve só em
 *     `broadcast_recipients`, nunca em `messages`, e a espera seria sempre
 *     inteira, para nada.
 */
export function pausasDoReciboDaMeta(
  recibo: StatusDoRecibo,
  { deDisparo }: { deDisparo: boolean },
): readonly number[] {
  if (recibo === 'sent' || deDisparo) return [];
  return PAUSAS_DO_RECIBO_DA_META_MS;
}
