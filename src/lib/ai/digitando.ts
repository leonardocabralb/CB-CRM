import type { SupabaseClient } from '@supabase/supabase-js'

import { resolveEngineChannelPreferring } from '@/lib/cb-channels/engine-send'
import { ehMeta } from '@/lib/cb-channels/transporte'
import { semTokenDaMeta } from '@/lib/cb-channels/falha-da-meta'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTypingIndicator } from '@/lib/whatsapp/meta-api'

// ============================================================
// "Digitando…" enquanto a IA prepara a resposta (#527 do original, Fase 9 do
// plano do merge do upstream).
//
// O original lia as credenciais da CONTA (`loadAccountMetaCredentials`, o
// número padrão de `whatsapp_config`). Aqui o indicador sai pelo MESMO canal
// da resposta — a mesma resolução de `engineSendText` com o canal por onde o
// cliente escreveu —, e só quando esse canal é da Meta: numa conta com dois
// números oficiais, o do original marcaria a mensagem num número e a resposta
// sairia pelo outro. A Evolution não tem o recurso.
//
// ⚠️ A Meta NÃO manda o "digitando…" sem marcar a mensagem do cliente como
// LIDA (tique azul): é um campo do recibo de leitura. O operador sabe e
// decidiu manter (P6, 24/09/2026). Hoje é inerte: a resposta automática está
// desligada na produção.
//
// Melhor esforço: nunca lança, e segura a resposta no máximo
// `PRAZO_DO_DIGITANDO_MS` (`concluirDigitando`). A falha vai para o log SEM o
// token (a Meta ecoa o token em alguns erros).
// ============================================================

export type ResultadoDoDigitando = 'enviado' | 'pulado' | 'falhou'

/** Quanto a resposta espera o "digitando…" terminar. */
export const PRAZO_DO_DIGITANDO_MS = 2_000

/**
 * Espera o "digitando…" terminar ANTES de a resposta sair, por no máximo
 * `PRAZO_DO_DIGITANDO_MS`, e cancela o que passar disso (revisão do PR #288).
 * Solto (`void`), o pedido podia chegar à Meta DEPOIS da resposta, e o
 * cliente via "digitando…" embaixo da mensagem que já tinha recebido.
 */
export async function concluirDigitando(
  digitando: Promise<ResultadoDoDigitando>,
  cancelar: AbortController,
): Promise<void> {
  let prazo: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    digitando,
    new Promise<void>((resolve) => {
      prazo = setTimeout(resolve, PRAZO_DO_DIGITANDO_MS)
    }),
  ])
  clearTimeout(prazo)
  cancelar.abort()
}

export async function mostrarDigitando(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    /** O canal por onde o cliente escreveu — o mesmo `preferredChannelId` da resposta. */
    channelId: string | null
    /** O `wamid` da mensagem RECEBIDA que a IA vai responder. */
    inboundMessageId: string | null | undefined
    /** Cancelado por `concluirDigitando` quando a resposta vai sair. */
    sinal?: AbortSignal
  },
): Promise<ResultadoDoDigitando> {
  const { accountId, conversationId, channelId, inboundMessageId, sinal } = args
  // Só mensagem que CHEGOU pela API da Meta tem `wamid.`; a da Evolution não
  // existe do lado da Meta, e o pedido voltaria erro.
  if (!inboundMessageId || !inboundMessageId.startsWith('wamid.')) return 'pulado'

  let token = ''
  try {
    const canal = await resolveEngineChannelPreferring(db, accountId, conversationId, channelId)
    if (!canal || !ehMeta(canal)) return 'pulado'
    if (!canal.phone_number_id || !canal.access_token) return 'pulado'
    // A resposta já saiu (ou o prazo acabou) enquanto o canal era resolvido.
    if (sinal?.aborted) return 'pulado'
    token = decrypt(canal.access_token)
    await sendTypingIndicator({
      phoneNumberId: canal.phone_number_id,
      accessToken: token,
      messageId: inboundMessageId,
      ...(sinal ? { signal: sinal } : {}),
    })
    return 'enviado'
  } catch (err) {
    const texto = err instanceof Error ? err.message : String(err)
    console.warn(`[ai auto-reply] "digitando…" não saiu: ${semTokenDaMeta(texto, token)}`)
    return 'falhou'
  }
}
