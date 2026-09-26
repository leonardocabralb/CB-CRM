import { NextResponse } from 'next/server'
import { resolveMetaChannel } from '@/lib/cb-channels/resolve-meta'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { resolveTemplateRow } from '@/lib/whatsapp/template-body'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
  /** O `recipient_id` que veio no pedido, devolvido para o navegador casar. */
  recipient_id?: string
  /**
   * `true` quando ESTA rota já gravou o envio na linha de
   * `broadcast_recipients` (ver `anotarEnvio`); o navegador não regrava.
   */
  anotado?: boolean
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /**
   * A linha de `broadcast_recipients` deste envio. Com ela a rota anota o
   * wamid NA HORA em que a Meta aceita (`anotarEnvio`).
   */
  recipient_id?: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

/**
 * Grava o envio na linha do destinatário logo que a Meta o aceita: `sent`,
 * a hora e o wamid.
 *
 * ⚠️⚠️ Sem isto o wamid só chegava a `broadcast_recipients` quando o lote de
 * 10 voltava ao navegador (segundos depois do primeiro envio), e o recibo da
 * Meta que chegasse antes não achava o destinatário: esperava os 7 s da rota
 * do webhook reconferindo e, passado isso, se perdia — a campanha ficava sem
 * "entregue"/"lida" para aquele cliente (revisão do PR #277).
 *
 * ⚠️ Só sai de `pending`: a linha que já andou (outro passe de envio, o
 * recibo) não volta a `sent`. `false` (erro, RLS ou 0 linhas) deixa a
 * gravação para o navegador, como era antes. Nunca lança: a mensagem já
 * saiu, e um erro aqui não pode virar "falhou" no resultado.
 */
async function anotarEnvio(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  recipientId: string,
  wamid: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('broadcast_recipients')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        whatsapp_message_id: wamid,
        error_message: null,
      })
      .eq('id', recipientId)
      .eq('status', 'pending')
      .select('id')
    if (error) {
      console.error('[broadcast] não anotou o envio na linha do destinatário:', error.message)
      return false
    }
    return (data?.length ?? 0) > 0
  } catch (err) {
    console.error('[broadcast] não anotou o envio na linha do destinatário:', err)
    return false
  }
}

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    //
    // Esta rota só ESCREVE a linha do destinatário que já existe (o wamid,
    // `anotarEnvio`, sob a RLS de quem chamou): o envio em si é uma chamada
    // à Meta, e nenhuma policy seguraria um papel que não pode disparar —
    // resolving `account_id` straight off the profile (which only needs
    // 'viewer') was the ONLY gate, and it let a viewer blast a template
    // to arbitrary phone numbers from the account's WhatsApp number.
    // Nothing about that is recoverable after the fact, so the check has
    // to happen here.
    const { supabase, accountId, userId } = await requireRole('admin')  // disparo em massa é só do admin (perfis, 2026-08-30)

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Nota de merge (upstream #448): o `requireRole` acima faz exatamente o
    // que o nosso `barrarPorPapel` fazia aqui — e ainda resolve o account_id.
    // O bloco nosso saiu por ser redundante, não por abrir mão da guarda.
    // (Era 'agent' até a Fase 2 dos perfis, 2026-08-30, quando disparo em
    // massa virou exclusivo do admin — atenção ao mesclar upstream: manter
    // 'admin'.)
    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    // Canal de saida (multi-canal, Fase E4). A pergunta deixou de ser "o
    // PADRAO e Meta?" e passou a ser "EXISTE canal Meta utilizavel?" — antes,
    // a conta cujo padrao e Evolution recebia o erro mesmo tendo acabado de
    // conectar o numero oficial como canal adicional.
    const canal = await resolveMetaChannel(
      supabase,
      accountId,
      typeof body.channel_id === 'string' ? body.channel_id : null,
    )
    if (!canal) {
      return NextResponse.json(
        {
          error:
            'Broadcasts require an official Meta (Cloud API) number — connect one in Settings > Connections, or pick a different channel.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(canal.accessToken)

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    // O 5º argumento é nosso: o catálogo da Meta é POR WABA, então o modelo
    // tem que ser o do canal por onde a campanha sai. `resolveTemplateRow`
    // cai para o modelo global (channel_id NULL, pré-903) quando o canal não
    // tem um próprio — ver template-body.ts.
    const resolvedTemplate = await resolveTemplateRow(
      supabase,
      accountId,
      template_name,
      template_language,
      canal.channelId,
    )
    if (resolvedTemplate.malformed) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = resolvedTemplate.row

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
          ...(typeof recipient.recipient_id === 'string'
            ? { recipient_id: recipient.recipient_id }
            : {}),
        })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: canal.phoneNumberId,
            accessToken,
            to: variant,
            templateName: template_name,
            language: resolvedTemplate.language,
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        const recipientId =
          typeof recipient.recipient_id === 'string' ? recipient.recipient_id : undefined
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
          ...(recipientId
            ? {
                recipient_id: recipientId,
                anotado: await anotarEnvio(supabase, recipientId, sentMessageId),
              }
            : {}),
        })
        sentCount++
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
          ...(typeof recipient.recipient_id === 'string'
            ? { recipient_id: recipient.recipient_id }
            : {}),
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp broadcast POST:', error)
    return toErrorResponse(error)
  }
}
