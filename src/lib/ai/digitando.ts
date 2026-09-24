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
// Melhor esforço: nunca lança e nunca segura a resposta. A falha vai para o
// log SEM o token (a Meta ecoa o token em alguns erros).
// ============================================================

export type ResultadoDoDigitando = 'enviado' | 'pulado' | 'falhou'

export async function mostrarDigitando(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    /** O canal por onde o cliente escreveu — o mesmo `preferredChannelId` da resposta. */
    channelId: string | null
    /** O `wamid` da mensagem RECEBIDA que a IA vai responder. */
    inboundMessageId: string | null | undefined
  },
): Promise<ResultadoDoDigitando> {
  const { accountId, conversationId, channelId, inboundMessageId } = args
  // Só mensagem que CHEGOU pela API da Meta tem `wamid.`; a da Evolution não
  // existe do lado da Meta, e o pedido voltaria erro.
  if (!inboundMessageId || !inboundMessageId.startsWith('wamid.')) return 'pulado'

  let token = ''
  try {
    const canal = await resolveEngineChannelPreferring(db, accountId, conversationId, channelId)
    if (!canal || !ehMeta(canal)) return 'pulado'
    if (!canal.phone_number_id || !canal.access_token) return 'pulado'
    token = decrypt(canal.access_token)
    await sendTypingIndicator({
      phoneNumberId: canal.phone_number_id,
      accessToken: token,
      messageId: inboundMessageId,
    })
    return 'enviado'
  } catch (err) {
    const texto = err instanceof Error ? err.message : String(err)
    console.warn(`[ai auto-reply] "digitando…" não saiu: ${semTokenDaMeta(texto, token)}`)
    return 'falhou'
  }
}
