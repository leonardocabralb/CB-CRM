import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getChannelWithSecrets } from '@/lib/cb-channels/repo'
import type { CbChannelWithSecrets } from '@/lib/cb-channels/repo'

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
    if (channel?.kind === 'meta' && channel.access_token && !channel.is_default) {
      encryptedToken = channel.access_token
    }
    if (!encryptedToken && config?.access_token) {
      encryptedToken = config.access_token
    }
    if (!encryptedToken && channel?.kind === 'meta' && channel.access_token) {
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

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
