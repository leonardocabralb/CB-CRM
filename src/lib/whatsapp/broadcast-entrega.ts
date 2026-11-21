// ============================================================
// ENTREGA do disparo, linha a linha (migration 1151) — NOSSO.
//
// Quem ENVIA um destinatário do disparo — a rota do lote do assistente
// (`api/whatsapp/broadcast`) e o envio pelo servidor (`deliverBroadcast`:
// Retomar, "Tentar de novo", API v1) — segue a mesma ordem:
//
//  1. MONTA o modelo (`falhaDaMontagem`): o que não monta não vai à Meta e é
//     `failed` (nada saiu; reenviar depois de consertar é seguro).
//  2. RESERVA a linha (`reservarDestinatario`): `pending` (ou o escopo da
//     retomada) → `uncertain`, num UPDATE condicional. Não reservou = não
//     manda: outro envio a tem, ou ela já saiu.
//  3. Chama a Meta e grava o que aprendeu (`gravarDesfechoDaReserva`, cercado
//     por `uncertain`): `sent` com o wamid; `failed` na recusa COMPROVADA
//     (4xx, `recusaComprovada`); senão a linha FICA `uncertain` — 5xx, tempo
//     esgotado e erro de rede podem ter saído (CLAUDE.md, 8e).
//
// ⚠️⚠️ Por isso `pending` quer dizer "comprovadamente não saiu": tudo o que foi
// à Meta passou antes por `uncertain`. Aba fechada, rede caída, deploy no meio
// do lote ou chamada pendurada deixam incerta só a linha que estava saindo —
// e nenhum reenvio (Retomar, "Tentar de novo os que falharam", "todos") pega
// `uncertain`. Antes, o lote que caía virava `failed` inteiro, e o "Tentar de
// novo" mandava o modelo PAGO em dobro a quem já tinha recebido.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { recusaComprovada } from '@/lib/automations/retentativa';
import { ENTREGA_INCERTA } from '@/lib/broadcast-status';
import {
  buildSendComponents,
  type SendTimeParams,
} from '@/lib/whatsapp/template-send-builder';
import type { MessageTemplate } from '@/types';

/** `reservada` = é deste envio; `ocupada` = não estava mais no estado pedido; `erro` = não deu para saber (não manda). */
export type Reserva = 'reservada' | 'ocupada' | 'erro';

/**
 * Passa a linha a `uncertain` ANTES de chamar a Meta — só se ela ainda estiver
 * num dos `origens` (o disparo novo: `pending`; a retomada: o escopo dela).
 *
 * ⚠️ É a cerca do envio: duas mãos (a rota de um lote que o navegador deu por
 * perdido e o Retomar, por exemplo) nunca mandam a MESMA linha — uma reserva,
 * a outra recebe `ocupada` e pula. `erro` também não manda: a linha fica como
 * estava (ou já incerta, se a escrita gravou e a resposta se perdeu — o erro
 * barato).
 */
export async function reservarDestinatario(
  db: SupabaseClient,
  recipientId: string,
  origens: readonly string[] = ['pending'],
): Promise<Reserva> {
  try {
    const { data, error } = await db
      .from('broadcast_recipients')
      .update({ status: ENTREGA_INCERTA, error_message: null })
      .eq('id', recipientId)
      .in('status', [...origens])
      .select('id');
    if (error) {
      console.error('[broadcast] não reservou o destinatário:', error.message);
      return 'erro';
    }
    return (data?.length ?? 0) > 0 ? 'reservada' : 'ocupada';
  } catch (err) {
    console.error('[broadcast] não reservou o destinatário:', err);
    return 'erro';
  }
}

/** O que a chamada à Meta ensinou sobre uma linha reservada. */
export type DesfechoDaLinha =
  | { status: 'sent'; whatsappMessageId: string }
  | { status: 'failed'; erro: string }
  | { status: 'uncertain'; erro: string };

/**
 * Grava o desfecho na linha que ESTE envio reservou — cerca `uncertain`, a
 * marca da própria reserva. `false` = não gravou (erro, 0 linhas); nunca lança:
 * a mensagem pode já ter saído, e um erro aqui não pode virar "falhou".
 *
 * Na incerta, só o motivo: a linha já está `uncertain` desde a reserva.
 */
export async function gravarDesfechoDaReserva(
  db: SupabaseClient,
  recipientId: string,
  desfecho: DesfechoDaLinha,
): Promise<boolean> {
  const patch =
    desfecho.status === 'sent'
      ? {
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: desfecho.whatsappMessageId,
          error_message: null,
        }
      : desfecho.status === 'failed'
        ? { status: 'failed', error_message: desfecho.erro }
        : { error_message: desfecho.erro };
  try {
    const { data, error } = await db
      .from('broadcast_recipients')
      .update(patch)
      .eq('id', recipientId)
      .eq('status', ENTREGA_INCERTA)
      .select('id');
    if (error) {
      console.error('[broadcast] não gravou o desfecho do destinatário:', error.message);
      return false;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    console.error('[broadcast] não gravou o desfecho do destinatário:', err);
    return false;
  }
}

/**
 * A chamada à Meta falhou: foi RECUSA comprovada (4xx — nada saiu, `failed`)
 * ou pode ter saído (`uncertain`)? A régua é a de `recusaComprovada`: só o 4xx
 * do provedor afirma "não saiu". Erro que não veio da Meta depois da montagem
 * (rede, tempo esgotado, resposta 200 ilegível) é incerto.
 */
export function desfechoDaFalha(err: unknown): 'failed' | 'uncertain' {
  return recusaComprovada(err) ? 'failed' : 'uncertain';
}

/**
 * Monta o modelo como `sendTemplateMessage` monta (`meta-api.ts`, a mesma
 * troca de `params` por `messageParams.body`) e devolve o motivo quando não
 * monta, ANTES da reserva — o modelo do núcleo (`send-message.ts`). Sem isto,
 * o erro de montagem (mídia do cabeçalho faltando, valores a menos) saía de
 * dentro do envio como um `Error` comum e seria lido como "pode ter saído".
 * Sem linha local do modelo, a montagem é a da Meta: nada a conferir aqui.
 */
export function falhaDaMontagem(
  template: MessageTemplate | null | undefined,
  params: string[],
  messageParams?: SendTimeParams,
): string | null {
  if (!template) return null;
  try {
    buildSendComponents(template, {
      body: messageParams?.body ?? params,
      headerText: messageParams?.headerText,
      headerMediaUrl: messageParams?.headerMediaUrl,
      headerMediaId: messageParams?.headerMediaId,
      buttonParams: messageParams?.buttonParams,
    });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
