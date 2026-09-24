import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getSubscribedApps, verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import {
  explainMetaError,
  metaErrorPayload,
  type MetaErrorExplanation,
} from '@/lib/whatsapp/meta-error-explain'
import { semTokenDaMeta } from '@/lib/cb-channels/falha-da-meta'
import { appSubscriptionState } from '@/lib/whatsapp/waba-pairing'
import { decrypt } from '@/lib/whatsapp/encryption'
import { flagDefaultMetaChannelRemoved } from '@/lib/cb-channels/legacy-mirror'
import { barrarPorPapel } from '@/lib/auth/barrar-por-papel'

/**
 * Resolve the caller's account_id from their profile. Inlined here
 * (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accountId: string; papel: unknown } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return { accountId: data.account_id as string, papel: data.account_role }
}

/**
 * NOSSO: a mensagem da Meta pode ECOAR o token ("Malformed access token
 * EAAB…"), e ela vai para a resposta e para o log. Ver `semTokenDaMeta`.
 */
function semToken(x: MetaErrorExplanation, token: string): MetaErrorExplanation {
  return {
    ...x,
    summary: semTokenDaMeta(x.summary, token),
    metaMessage: semTokenDaMeta(x.metaMessage, token),
  }
}

/**
 * GET /api/whatsapp/config
 *
 * Used by the "Test API Connection" button and by the page to check
 * whether the saved config is healthy. Returns 200 in all non-auth cases
 * so the UI can render an appropriate message rather than show a 500.
 *
 * Response shape:
 *   { connected: true,  phone_info: {...},
 *     waba_subscription: { checked, subscribed, app_id_match, error? } }
 *   { connected: false, reason: 'no_config',        message: '...' }
 *   { connected: false, reason: 'token_corrupted',  message: '...', needs_reset: true }
 *   { connected: false, reason: 'meta_api_error',   message: '...',
 *     meta: { code, subcode, fbtrace_id, step, field, message } }
 */
export async function GET() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const conta = await resolveAccountId(supabase, user.id)
    const accountId = conta?.accountId
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    // LEITURA é permitida a qualquer membro, inclusive `viewer`: a tela de
    // Configurações precisa mostrar o estado da conexão para quem só observa.
    // A guarda de papel fica nos handlers de ESCRITA (POST e DELETE).

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, waba_id, access_token, status')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError) {
      console.error('Error fetching whatsapp_config:', configError)
      return NextResponse.json(
        { connected: false, reason: 'db_error', message: 'Failed to fetch configuration' },
        { status: 200 }
      )
    }

    if (!config) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_config',
          message: 'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
        },
        { status: 200 }
      )
    }

    // Try to decrypt the stored token with the current ENCRYPTION_KEY.
    // If this fails, the key changed (or was never consistent across envs).
    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch (err) {
      console.error('[whatsapp/config GET] Token decryption failed:', err)
      return NextResponse.json(
        {
          connected: false,
          reason: 'token_corrupted',
          needs_reset: true,
          message:
            'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. This usually means the key changed, or it differs between environments (local vs Hostinger vs Vercel). Click "Reset Configuration" below, then re-save.',
        },
        { status: 200 }
      )
    }

    // Validate credentials against Meta
    let phoneInfo
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      })
    } catch (err) {
      const explained = semToken(
        explainMetaError(err, 'verify_number', {
          phoneNumberId: config.phone_number_id,
          wabaId: config.waba_id,
        }),
        accessToken,
      )
      console.error('[whatsapp/config GET] Meta API verification failed:', explained.metaMessage)
      return NextResponse.json(
        {
          connected: false,
          reason: 'meta_api_error',
          message: explained.summary,
          meta: metaErrorPayload(explained),
        },
        { status: 200 }
      )
    }

    // Credentials work. Also report whether the WABA is subscribed to
    // this app — valid credentials with an unsubscribed WABA is exactly
    // the "connected but no messages arrive" state (issue #505). Never
    // fatal: the token may lack whatsapp_business_management and still
    // be fine for sending.
    let wabaSubscription: {
      checked: boolean
      subscribed: boolean | null
      app_id_match: boolean | null
      error?: string
    } = { checked: false, subscribed: null, app_id_match: null }
    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({ wabaId: config.waba_id, accessToken })
        const state = appSubscriptionState(subs, process.env.META_APP_ID)
        wabaSubscription = {
          checked: true,
          subscribed: state.subscribed,
          app_id_match: state.appIdMatch,
        }
      } catch (err) {
        const explained = semToken(
          explainMetaError(err, 'subscribed_apps', { wabaId: config.waba_id }),
          accessToken,
        )
        wabaSubscription = {
          checked: true,
          subscribed: null,
          app_id_match: null,
          error: explained.summary,
        }
      }
    }

    return NextResponse.json({
      connected: true,
      phone_info: phoneInfo,
      waba_subscription: wabaSubscription,
    })
  } catch (error) {
    console.error('Error in WhatsApp config GET:', error)
    return NextResponse.json(
      { connected: false, reason: 'unknown', message: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/whatsapp/config — APOSENTADA (Fase 7 do plano do merge do
 * upstream, 24/09/2026). NOSSO.
 *
 * Era o caminho de UM número só: gravava a credencial da Meta direto no
 * espelho `whatsapp_config`, sem criar conexão em `cb_channels`. Três motivos
 * para aposentar em vez de consertar:
 *   - desde 27/07/2026 (75daeb97) ela respondia 500 a TODA chamada — a
 *     conferência do número já tomado pedia `account_role` a
 *     `whatsapp_config`, coluna que não existe —, e ninguém percebeu, porque
 *     a única tela que a chamava (`whatsapp-config.tsx`) não é montada;
 *   - consertada, ela gravaria a credencial da Meta por cima do espelho de
 *     uma conta cujo padrão é Evolution (o UPDATE não toca em `provider`),
 *     sem conexão nenhuma no painel;
 *   - o que o #505 trouxe para ela (a explicação do erro e a conferência do
 *     par WABA/número) foi portado para quem conecta de verdade:
 *     `POST /api/cb/channels` (Configurações → Conexões).
 * Um merge do original que traga o POST cru de volta REPROVA o pino
 * `guarda-de-papel-so-nossa.test.ts`.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Esta rota foi substituída por Configurações → Conexões (POST /api/cb/channels).',
      code: 'rota_substituida',
    },
    { status: 410 },
  )
}

/**
 * DELETE /api/whatsapp/config
 *
 * Removes the authenticated user's WhatsApp configuration row.
 * Used by the "Reset Configuration" button to recover from a corrupted
 * encrypted token (mismatched ENCRYPTION_KEY across environments).
 */
export async function DELETE() {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const conta = await resolveAccountId(supabase, user.id)
    const accountId = conta?.accountId
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // Papel, não só sessão: sem isto um `viewer` — que existe para ser
    // somente-leitura — executava esta ação. O efeito colateral (chamada
    // à Meta/Evolution) acontece antes de qualquer gravação, então a RLS
    // nunca entraria no caminho.
    const barrado = barrarPorPapel(conta?.papel, 'admin');
    if (barrado) return barrado;

    const { error: deleteError } = await supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', accountId)

    if (deleteError) {
      console.error('Error deleting whatsapp_config:', deleteError)
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 }
      )
    }

    // Espelho multi-canal (best-effort, Fase 5): sinaliza no canal padrão
    // Meta que a configuração legada foi removida, para o painel de
    // Conexões não exibir um canal "conectado" sem lastro.
    await flagDefaultMetaChannelRemoved(supabase, accountId)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error in WhatsApp config DELETE:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
