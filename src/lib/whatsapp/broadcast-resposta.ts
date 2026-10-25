// ============================================================
// A resposta do cliente conta para o disparo CERTO (porte do #671 do
// original: `flagBroadcastReply` + `isReplyAttributable`).
//
// Quando o cliente escreve, o webhook da Meta marca `replied` no destinatário
// do disparo (o gatilho da 003 soma o "Responderam" da campanha). A régua
// antiga procurava o destinatário mais recente do contato ENTRE `sent`,
// `delivered` e `read`, sem janela nenhuma:
//  - a resposta meses depois contava para uma campanha velha;
//  - com o destinatário da campanha mais nova já `replied` (a 2ª mensagem do
//    cliente) ou `failed` (não chegou), a busca pulava para a ANTERIOR, de
//    qualquer idade, e ela levava o crédito de uma resposta que não era a ela.
//
// A régua agora: lê SÓ a linha mais recente do contato na conta, em qualquer
// situação, e marca só se ela está em `sent`/`delivered`/`read` e foi enviada
// há no máximo 7 dias. Consequência aceita (a mesma do original): com a mais
// recente ainda `pending` (campanha saindo em lotes) ou `failed`, a resposta
// não conta para NENHUMA — nem para a anterior que chegou dentro dos 7 dias. O UPDATE é condicional (`.in('status', …)`): dois
// webhooks do mesmo cliente ao mesmo tempo não marcam duas vezes, e um
// `replied` nunca volta a ser escrito.
//
// ⚠️ NOSSO, num módulo próprio: o `broadcast-recipient-webhook.ts` do
// original carrega também `applyBroadcastRecipientStatus`, e o espelho do
// recibo aqui é o da rota (`origensDoDestinatario`, condicional desde
// 23/09/2026). A régua é a dele; a única diferença é a lista do UPDATE, que
// aqui é a mesma da conferência (a dele inclui `pending`, que a exigência de
// `sent_at` já deixava de fora).
//
// Best effort: a mensagem do cliente já está gravada, então nada aqui lança —
// erro vira log e `'erro'`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Até quanto tempo depois do ENVIO uma resposta ainda conta para o disparo. */
export const JANELA_DA_RESPOSTA_AO_DISPARO_MS = 7 * 24 * 60 * 60 * 1000;

/** As situações do destinatário de onde uma resposta o leva a `replied`. */
export const SITUACOES_QUE_ACEITAM_RESPOSTA = ['sent', 'delivered', 'read'] as const;

export type DesfechoDaResposta = 'marcou' | 'pulou' | 'erro';

interface DestinatarioMaisRecente {
  id: string;
  status: string;
  sent_at: string | null;
}

/**
 * A resposta que chegou `agora` conta para ESTE destinatário? Só se ele está
 * numa situação que aceita resposta e foi enviado dentro da janela. Sem
 * `sent_at` (ou ilegível), não: não há como saber se a mensagem chegou a
 * tempo.
 */
export function respostaContaParaODisparo(
  destinatario: { status: string; sent_at: string | null },
  agora: Date,
): boolean {
  if (!(SITUACOES_QUE_ACEITAM_RESPOSTA as readonly string[]).includes(destinatario.status)) {
    return false;
  }
  if (!destinatario.sent_at) return false;
  const enviadoEm = Date.parse(destinatario.sent_at);
  if (Number.isNaN(enviadoEm)) return false;
  return agora.getTime() - enviadoEm <= JANELA_DA_RESPOSTA_AO_DISPARO_MS;
}

/**
 * Marca `replied` no destinatário do disparo mais recente do contato, se a
 * resposta conta para ele (`respostaContaParaODisparo`). Nunca lança.
 */
export async function marcarRespostaAoDisparo(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  agora: Date = new Date(),
): Promise<DesfechoDaResposta> {
  try {
    // A linha mais recente do contato NA CONTA, em qualquer situação: a
    // campanha mais nova que o alcançou é a única que pode levar o crédito.
    // Recortada pela conta da campanha, para a resposta numa caixa
    // compartilhada contar seja qual for o colega que disparou.
    const { data, error } = await db
      .from('broadcast_recipients')
      .select('id, status, sent_at, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[broadcast-resposta] leitura do destinatário falhou:', error.message);
      return 'erro';
    }
    const maisRecente = (data?.[0] ?? null) as DestinatarioMaisRecente | null;
    if (!maisRecente || !respostaContaParaODisparo(maisRecente, agora)) return 'pulou';

    const { data: marcadas, error: erroAoMarcar } = await db
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: agora.toISOString() })
      .eq('id', maisRecente.id)
      // A situação conferida acima é a da linha LIDA; esta, a do banco na hora
      // da escrita — um webhook concorrente que já marcou ganha.
      .in('status', [...SITUACOES_QUE_ACEITAM_RESPOSTA])
      .select('id');

    if (erroAoMarcar) {
      console.error('[broadcast-resposta] marcar a resposta falhou:', erroAoMarcar.message);
      return 'erro';
    }
    return (marcadas?.length ?? 0) > 0 ? 'marcou' : 'pulou';
  } catch (err) {
    console.error(
      '[broadcast-resposta] marcar a resposta lançou:',
      err instanceof Error ? err.message : err,
    );
    return 'erro';
  }
}
