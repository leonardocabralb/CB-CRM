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
import { renovarPosseDoDisparo } from '@/lib/whatsapp/broadcast-posse'
import {
  desfechoDaFalha,
  falhaDaMontagem,
  gravarDesfechoDaReserva,
  reservarDestinatario,
} from '@/lib/whatsapp/broadcast-entrega'
import { semTokenDaMeta } from '@/lib/cb-channels/falha-da-meta'

/**
 * NOSSO (posse do envio, 1147): a posse que o assistente manda junto do lote
 * é renovada AQUI antes do primeiro envio e de novo a cada este tanto,
 * enquanto o lote anda. A posse vale 5 min: renovada só no navegador, um lote
 * que se arrastasse no servidor (a Meta lenta ou pendurada — o `fetch` não tem
 * prazo) ou um pedido que chegasse atrasado deixava a retomada assumir no
 * meio, e os dois mandavam os mesmos pendentes.
 */
const RENOVAR_A_POSSE_NO_LOTE_MS = 60_000

interface BroadcastResult {
  phone: string
  /**
   * NOSSO (1151): `uncertain` = foi à Meta e ninguém confirmou o desfecho
   * (5xx, tempo esgotado, rede) — PODE ter saído; a linha fica `uncertain` e
   * nenhum reenvio a pega. `skipped` = a linha não estava mais pendente na
   * RESERVA (outro envio a tem, ou já saiu): nada foi enviado a ela, e o
   * navegador não grava nada.
   */
  status: 'sent' | 'failed' | 'uncertain' | 'skipped'
  whatsapp_message_id?: string
  error?: string
  /** O `recipient_id` que veio no pedido, devolvido para o navegador casar. */
  recipient_id?: string
  /**
   * `true` quando ESTA rota já gravou o desfecho na linha de
   * `broadcast_recipients` (o envio, a recusa ou o motivo da incerta, ver
   * `gravarDesfechoDaReserva`); o navegador não regrava.
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
   * A linha de `broadcast_recipients` deste envio. Com ela a rota a RESERVA
   * antes da Meta e grava o wamid NA HORA em que a Meta aceita (1151,
   * `broadcast-entrega.ts`).
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

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    //
    // Esta rota só ESCREVE a linha do destinatário que já existe (a reserva e
    // o desfecho, 1151, sob a RLS de quem chamou): o envio em si é uma chamada
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
    // NOSSO (1147): a campanha e o token da posse do assistente. Sem os dois
    // (o pedido de uma aba aberta antes do deploy) a rota manda como antes.
    const posseDoLote =
      typeof body.broadcast_id === 'string' && typeof body.posse === 'string'
        ? { broadcastId: body.broadcast_id as string, token: body.posse as string }
        : null

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
    let uncertainCount = 0
    // `0` força a renovação antes do PRIMEIRO envio: o pedido pode ter
    // chegado atrasado, depois de a posse vencer e a retomada assumir.
    let posseRenovadaEm = 0
    let semPosse: 'posse_perdida' | 'posse_incerta' | null = null

    for (const recipient of recipients) {
      if (posseDoLote && Date.now() - posseRenovadaEm >= RENOVAR_A_POSSE_NO_LOTE_MS) {
        const posse = await renovarPosseDoDisparo(
          supabase,
          posseDoLote.broadcastId,
          posseDoLote.token,
        )
        if (posse.situacao !== 'mantida') {
          // ⚠️⚠️ Sem posse, nem mais um envio: quem assumiu (a retomada) manda
          // os que faltam. O que já saiu volta em `results` para o navegador
          // gravar; o resto fica `pending`.
          semPosse = posse.situacao === 'perdida' ? 'posse_perdida' : 'posse_incerta'
          break
        }
        posseRenovadaEm = Date.now()
      }

      const recipientId =
        typeof recipient.recipient_id === 'string' ? recipient.recipient_id : undefined
      const daLinha = recipientId ? { recipient_id: recipientId } : {}
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
          ...daLinha,
        })
        failedCount++
        continue
      }

      // NOSSO (1151): o modelo é MONTADO antes da reserva, como no núcleo
      // (`send-message.ts`). O que não monta (mídia do cabeçalho faltando,
      // valores a menos) nunca chega à Meta: `failed`, reenviar é seguro.
      const naoMonta = falhaDaMontagem(
        templateRow,
        recipient.params ?? [],
        recipient.messageParams,
      )
      if (naoMonta) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: `Template cannot be sent: ${naoMonta}`,
          ...daLinha,
        })
        failedCount++
        continue
      }

      // ⚠️⚠️ NOSSO (1151): RESERVA a linha (`pending` → `uncertain`) ANTES da
      // Meta. Tudo o que vai à Meta passa por `uncertain`, então a queda no
      // meio (aba, rede, deploy, chamada pendurada) deixa incerta só esta
      // linha, nunca a dá por não enviada — e a mão que não reservou (o
      // Retomar, o lote repetido) não manda. Pedido sem `recipient_id` (forma
      // antiga) não tem linha a reservar e manda como antes.
      if (recipientId) {
        const reserva = await reservarDestinatario(supabase, recipientId)
        if (reserva === 'ocupada') {
          results.push({ phone: recipient.phone, status: 'skipped', ...daLinha })
          continue
        }
        if (reserva === 'erro') {
          results.push({
            phone: recipient.phone,
            status: 'failed',
            error: 'Could not reserve this recipient before sending; nothing was sent to them.',
            ...daLinha,
          })
          failedCount++
          continue
        }
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: unknown = null

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
          lastError = error
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) break
          // retry with next variant
        }
      }

      if (sentMessageId) {
        // Gravado NA HORA em que a Meta aceita (revisão do PR #277): o recibo
        // que chegasse antes do lote voltar ao navegador não achava o
        // destinatário. Cercado pela reserva; `false` deixa para o navegador.
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
          ...(recipientId
            ? {
                recipient_id: recipientId,
                anotado: await gravarDesfechoDaReserva(supabase, recipientId, {
                  status: 'sent',
                  whatsappMessageId: sentMessageId,
                }),
              }
            : {}),
        })
        sentCount++
        continue
      }

      // ⚠️⚠️ NOSSO (1151): só a recusa COMPROVADA (4xx) é `failed`; 5xx, tempo
      // esgotado e erro de rede PODEM ter saído (CLAUDE.md, 8e) e a linha fica
      // `uncertain` — fora do "Tentar de novo os que falharam". Sem variante
      // tentada (lista vazia), nada saiu. A mensagem da Meta ECOA o token.
      const desfecho = lastError === null ? 'failed' : desfechoDaFalha(lastError)
      const erro = semTokenDaMeta(
        lastError instanceof Error ? lastError.message : 'Unknown error',
        accessToken,
      )
      console.error(`Failed to send broadcast to ${recipient.phone} (${desfecho}):`, erro)
      results.push({
        phone: recipient.phone,
        status: desfecho,
        error: erro,
        ...(recipientId
          ? {
              recipient_id: recipientId,
              anotado: await gravarDesfechoDaReserva(supabase, recipientId, {
                status: desfecho,
                erro,
              }),
            }
          : {}),
      })
      if (desfecho === 'failed') {
        failedCount++
        continue
      }
      uncertainCount++
      // ⚠️⚠️ Disjuntor (1151): a Meta (ou a rede até ela) não respondeu. Seguir
      // mandando faria de CADA destinatário uma incerta — a campanha inteira
      // fora do reenvio numa pane da Meta. Para aqui: o resto do lote não foi
      // reservado (`pending`, comprovadamente não saiu), e o assistente para ao
      // ver a incerta no resultado; o Retomar manda o resto depois.
      break
    }

    if (semPosse) {
      return NextResponse.json(
        {
          success: false,
          code: semPosse,
          error:
            semPosse === 'posse_perdida'
              ? 'Another delivery took over this broadcast; the rest of this batch was not sent.'
              : 'Could not confirm this tab still owns the delivery; the rest of this batch was not sent.',
          total: recipients.length,
          sent: sentCount,
          failed: failedCount,
          uncertain: uncertainCount,
          results,
        },
        { status: 409 },
      )
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      uncertain: uncertainCount,
      results,
    })
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp broadcast POST:', error)
    return toErrorResponse(error)
  }
}
