import { NextResponse } from 'next/server'
import { resolveMetaChannel } from '@/lib/cb-channels/resolve-meta'
import {
  ForbiddenError,
  UnauthorizedError,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  CAMPOS_DO_MODELO,
  conteudoDoModeloDaMeta,
  type MetaTemplate,
} from '@/lib/whatsapp/modelo-da-meta'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * The local catalog stores Meta's status enum verbatim (APPROVED /
 * PENDING / REJECTED / PAUSED / DISABLED / IN_APPEAL / PENDING_DELETION)
 * so the edit / resubmit / delete flows can distinguish recoverable
 * states (PAUSED) from terminal ones (DISABLED) and so webhook events
 * land 1:1 without a translation table.
 *
 * Locally-created templates (no Meta counterpart) are NOT deleted —
 * they remain visible so the user can notice drift and clean up.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export async function POST(request: Request) {
  try {
    // Syncing rewrites the account-wide template catalog, which is
    // settings-class data: `canEditSettings` and the message_templates
    // insert/update RLS policies (migration 017) both require 'admin'.
    // Resolving account_id off the profile only proved membership.
    const { supabase, accountId, userId } = await requireRole('admin')

    // Multi-canal: sincroniza o catalogo do canal PEDIDO, ou do primeiro
    // canal Meta utilizavel. Antes lia so o espelho e perguntava se o PADRAO
    // era Meta — entao, numa conta cujo padrao e Evolution, "Sincronizar da
    // Meta" respondia "WABA ID missing. Re-connect your account" logo depois
    // de o operador conectar o numero oficial.
    const canalPedido =
      new URL(request.url).searchParams.get('channel_id') ?? null
    const canal = await resolveMetaChannel(supabase, accountId, canalPedido)

    if (!canal) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect an official Meta (Cloud API) number in Settings > Connections first.',
        },
        { status: 400 },
      )
    }

    if (!canal.wabaId) {
      return NextResponse.json(
        {
          error: `WABA (WhatsApp Business Account) ID missing for "${canal.label}". Re-connect that number in Settings.`,
        },
        { status: 400 },
      )
    }

    const accessToken = decrypt(canal.accessToken)

    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${canal.wabaId}/message_templates?limit=100&fields=${CAMPOS_DO_MODELO}`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const row = {
        // Account tenancy + user audit, same split as the submit
        // route. account_id is NOT NULL on message_templates
        // post-017, so an INSERT without it errors.
        account_id: accountId,
        user_id: userId,
        // Multi-canal: o catalogo da Meta e POR WABA. Carimbar a origem e o
        // que impede o modelo de um numero ser usado no outro — o atendente
        // via o preview certo e o cliente recebia outra coisa.
        channel_id: canal.channelId,
        // A conversão é a MESMA do stub do webhook (`modelo-da-meta.ts`).
        ...conteudoDoModeloDaMeta(t),
        updated_at: new Date().toISOString(),
      }

      // Escopado ao canal: sem isso, sincronizar o 2o numero SOBRESCREVERIA o
      // modelo homonimo do 1o, em vez de criar o dele. Modelos anteriores a
      // 903 (channel_id NULL) sao adotados por este canal na primeira sync.
      let lookup = supabase
        .from('message_templates')
        .select('id')
        .eq('account_id', accountId)
        .eq('name', t.name)
        .eq('language', t.language)
      lookup = canal.channelId
        ? lookup.or(`channel_id.eq.${canal.channelId},channel_id.is.null`)
        : lookup.is('channel_id', null)
      const { data: existing, error: lookupErr } = await lookup.maybeSingle()

      if (lookupErr) {
        errors.push({
          name: t.name,
          language: t.language,
          message: lookupErr.message,
        })
        continue
      }

      if (existing?.id) {
        const { error: updErr } = await supabase
          .from('message_templates')
          .update(row)
          .eq('id', existing.id)
        if (updErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: updErr.message,
          })
        } else {
          updated++
        }
      } else {
        const { error: insErr } = await supabase
          .from('message_templates')
          .insert(row)
        if (insErr) {
          errors.push({
            name: t.name,
            language: t.language,
            message: insErr.message,
          })
        } else {
          inserted++
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    // Auth failures map to 401/403 rather than being folded into the
    // generic 500 below, which surfaces `error.message` as a sync failure.
    if (
      error instanceof UnauthorizedError ||
      error instanceof ForbiddenError
    ) {
      return toErrorResponse(error)
    }
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
