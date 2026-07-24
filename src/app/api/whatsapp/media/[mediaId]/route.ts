import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import { getChannelWithSecrets } from '@/lib/cb-channels/repo'

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

    // Fetch and decrypt WhatsApp config
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    // Token: se a mídia veio carimbada com um canal ADICIONAL (?channel= de um
    // canal NÃO-padrão), usa o token daquele número — assim um 2º número Meta
    // com token próprio carrega sua mídia. O número PADRÃO usa sempre o
    // whatsapp_config (sua fonte autoritativa: a tela de config Meta grava lá),
    // EXATAMENTE como antes da 4a — mesmo que a URL traga o ?channel= dele, para
    // não pegar um token de cb_channels que possa ter ficado defasado após uma
    // rotação de token feita pela tela antiga. getChannelWithSecrets filtra por
    // account_id (tenancy). Canal inválido/sem token → cai no padrão.
    const channelId = new URL(request.url).searchParams.get('channel')
    let accessToken = decrypt(config.access_token)
    if (channelId) {
      try {
        const channel = await getChannelWithSecrets(supabase, accountId, channelId)
        if (channel?.kind === 'meta' && channel.access_token && !channel.is_default) {
          accessToken = decrypt(channel.access_token)
        }
      } catch (err) {
        console.warn(
          '[whatsapp/media] falha ao resolver canal; usando token padrão:',
          err instanceof Error ? err.message : err
        )
      }
    }

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
