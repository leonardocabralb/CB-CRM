import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getChannelWithSecrets } from '@/lib/cb-channels/repo'
import type { CbChannelWithSecrets } from '@/lib/cb-channels/repo'
import { ehMeta } from '@/lib/cb-channels/transporte'
import { mediaProxyHeaders } from '@/lib/media/proxy-response-headers'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Porte do upstream #660: cada pedido são duas idas à Meta (a URL e o
    // download), com o token da conta. Antes de qualquer leitura.
    const limit = checkRateLimit(`whatsapp-media:${user.id}`, RATE_LIMITS.whatsappMedia)
    if (!limit.success) return rateLimitResponse(limit)

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // O espelho pode não existir numa conta que só tem cb_channels — nesse caso
    // o token vem do próprio canal (abaixo), então aqui não se aborta.
    const { data: config } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle()

    const channelId = new URL(request.url).searchParams.get('channel')
    let channel: CbChannelWithSecrets | null = null
    if (channelId) {
      try {
        channel = await getChannelWithSecrets(supabase, accountId, channelId)
      } catch (err) {
        console.warn(
          '[whatsapp/media] falha ao resolver canal; usando token padrão:',
          err instanceof Error ? err.message : err
        )
      }
    }

    // Ordem deliberada de resolução do token:
    //   1) canal Meta ADICIONAL (não-padrão) → token do próprio número, para que
    //      um 2º número Meta carregue a sua mídia;
    //   2) whatsapp_config → fonte autoritativa do número PADRÃO (a tela de
    //      config Meta grava lá), inclusive quando a URL traz o ?channel= dele —
    //      evita usar um token de cb_channels defasado após rotação pela tela antiga;
    //   3) token do próprio canal → cobre a conta cujo PADRÃO é Evolution, em que
    //      whatsapp_config.access_token é NULL.
    //
    // ⚠️ A escolha vem ANTES de qualquer decrypt. decrypt(null) lança (faz
    // .split em string), e como isso rodava incondicionalmente, toda mídia de um
    // canal Meta adicional numa conta Evolution virava 500.
    let encryptedToken: string | null = null
    if (channel && ehMeta(channel) && channel.access_token && !channel.is_default) {
      encryptedToken = channel.access_token
    }
    if (!encryptedToken && config?.access_token) {
      encryptedToken = config.access_token
    }
    if (!encryptedToken && channel && ehMeta(channel) && channel.access_token) {
      encryptedToken = channel.access_token
    }

    if (!encryptedToken) {
      return NextResponse.json(
        { error: 'No official (Meta) WhatsApp channel is available to load this media.' },
        { status: 400 }
      )
    }

    const accessToken = decrypt(encryptedToken)

    // Get the download URL from Meta
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })

    // Download the binary data
    const { buffer, contentType } = await downloadMedia({
      downloadUrl: mediaInfo.url,
      accessToken,
    })

    // Upstream #678: o tipo vem do CLIENTE (o documento que ele mandou), e esta
    // resposta sai no NOSSO domínio — a bolha abre o link numa aba nova. Só
    // imagem, áudio e vídeo comuns vão `inline`; o resto (SVG, HTML, PDF…) vai
    // como download, com `sandbox` e sem cache compartilhado. Só chega aqui o
    // anexo que o espelho no `chat-media` não guardou (tipo fora da lista do
    // bucket, acima de 50 MiB, Storage fora do ar).
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: mediaProxyHeaders(mediaId, contentType || mediaInfo.mimeType),
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
