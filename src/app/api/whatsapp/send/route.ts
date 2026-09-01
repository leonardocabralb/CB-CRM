import { NextResponse } from 'next/server'
import { pinConversationChannel } from '@/lib/cb-channels/stamp'
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message'

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the two ways the UI targets a thread — an existing
// `conversation_id` (inbox) or a `contact_id` (Contact detail →
// find-or-create the conversation). The actual Meta plumbing (validate
// → send → persist → pause flows) lives in the shared
// `sendMessageToConversation` core, which the public `/api/v1/messages`
// endpoint reuses. This route is a thin adapter: resolve the
// conversation, delegate, then map `SendMessageError` back onto the
// dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    // Requires the 'agent' role, matching both `canSendMessages` and the
    // `messages_modify` RLS policy (migration 017).
    //
    // Resolving `account_id` off the profile — which any 'viewer' has —
    // was previously the only gate. RLS did block the message INSERT, but
    // the send core calls Meta BEFORE it persists, so a viewer's request
    // still delivered a real WhatsApp message to the customer and merely
    // failed to record it (surfacing as "sent to Meta but failed to save
    // to DB"). RLS can't un-send that, so the role check belongs here.
    const { supabase, accountId, userId } = await requireRole('agent')

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

      // Nota de merge (upstream #448): o `requireRole('agent')` acima exige
      // exatamente o mesmo papel que o nosso `barrarPorPapel` exigia aqui, e
      // ainda resolve o account_id. O bloco saiu por redundancia, nao por
      // abrir mao da guarda.
    const body = await request.json()
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send template) — we find-or-create one below.
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
      /** Canal escolhido explicitamente (seletor do compositor / primeiro
       *  contato pela ficha). FIXA a conversa naquele numero. */
      channel_id,
      /** Canal que a TELA estava mostrando quando o atendente digitou.
       *  Se divergir do canal real no instante do envio, a rota devolve 409
       *  em vez de enviar — ver o bloco de assert abaixo. */
      expected_channel_id,
    } = body

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      )
    }

    // Validate the message shape up front — before the contact_id path
    // finds-or-creates a conversation — so an invalid payload 400s
    // without leaving an orphan empty conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    // Resolve the target conversation. With `conversation_id` we load the
    // existing thread; with `contact_id` we find-or-create one for the
    // contact so a business-initiated template send (Contact detail view)
    // reuses the shared send core below.
    let conversationId: string | null = null

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (convError || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        )
      }
      conversationId = data.id
    } else {
      // contact_id path: verify the contact is in this account first so a
      // caller can't open a conversation against someone else's contact.
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        )
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        contact_id
      )
      if (!resolved) {
        return NextResponse.json(
          { error: 'Failed to open a conversation for this contact' },
          { status: 500 }
        )
      }
      conversationId = resolved
    }

    // ----------------------------------------------------------
    // Canal (multi-canal). Duas coisas distintas:
    //
    // 1. `channel_id` — escolha EXPLICITA. Fixa a conversa naquele numero
    //    (channel_pinned), para a resposta do cliente voltar pelo mesmo
    //    numero que ele viu. Cobre tambem o primeiro contato pela ficha, que
    //    antes saia sempre pelo canal padrao sem escolha.
    //
    // 2. `expected_channel_id` — ASSERT. O compositor manda o canal que
    //    estava na tela; se o canal real mudou nesse meio-tempo (o cliente
    //    escreveu por outro numero e a conversa "seguiu"), a rota devolve 409
    //    com o canal novo, em vez de mandar pelo numero errado.
    //    Num escritorio de advocacia, responder de um numero que o cliente
    //    nao esperava mistura identidades — por isso e uma PERGUNTA, nao um
    //    envio silencioso.
    // ----------------------------------------------------------
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Failed to resolve a conversation' },
        { status: 500 },
      )
    }
    if (typeof channel_id === 'string' && channel_id) {
      const fixou = await pinConversationChannel(
        supabase,
        accountId,
        conversationId,
        channel_id,
      )
      if (!fixou) {
        return NextResponse.json(
          { error: 'Canal inválido para esta conta.' },
          { status: 400 },
        )
      }
    } else if (typeof expected_channel_id === 'string' && expected_channel_id) {
      const atual = await resolveChannelForConversation(
        supabase,
        accountId,
        { channel_id: await currentConversationChannel(supabase, accountId, conversationId) },
      )
      if (atual?.channelId && atual.channelId !== expected_channel_id) {
        return NextResponse.json(
          {
            error: 'channel_changed',
            code: 'channel_changed',
            // Só o id: a UI já tem a lista de canais e resolve o rótulo,
            // evitando uma consulta extra no caminho do envio.
            current_channel_id: atual.channelId,
          },
          { status: 409 },
        )
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // Delegate to the shared send core (validates, sends to Meta with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
        // Este é o único caminho de envio que tem uma PESSOA identificada. O
        // `userId` (do requireRole) já estava aqui — chave do rate limit e do
        // findOrCreateConversation — e morria antes do insert.
        senderUserId: userId,
      })

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        // ⚠️ O texto COMO FICOU, que pode não ser o que veio no corpo: com a
        // assinatura ligada (923) o servidor prefixa. A bolha otimista foi
        // desenhada com o texto cru, então sem devolver isto ela mostraria
        // uma versão que nunca existiu até o realtime chegar e trocar o
        // texto na frente do operador.
        content_text: result.contentText,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        )
      }
      throw err
    }
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp send POST:', error)
    return toErrorResponse(error)
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a single
 * thread per contact. Runs under the caller's RLS — the conversations_insert
 * policy requires account agent membership, which the caller already is,
 * and accounts_select lets any member read the owner column below.
 */
async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id

  // `conversations.user_id` CASCADEia de `auth.users`: gravar o operador
  // faria o offboarding dele (apagar o login no dashboard) levar a conversa
  // e as mensagens do cliente. Grava-se o dono da conta, como a ingestão e
  // /api/cb/conversas/abrir — e sem dono resolvido a criação FALHA (nunca
  // cair para o operador autenticado).
  const { data: conta, error: contaErr } = await supabase
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .single()
  const donoDaConta = conta?.owner_user_id as string | undefined
  if (contaErr || !donoDaConta) {
    console.error(
      'Error resolving account owner for contact send:',
      contaErr?.message ?? 'owner_user_id empty',
    )
    return null
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: donoDaConta,
      contact_id: contactId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}

/** channel_id atual da conversa (sem resolver o padrao). */
async function currentConversationChannel(
  supabase: SendSupabase,
  accountId: string,
  conversationId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('channel_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  return (data as { channel_id?: string | null } | null)?.channel_id ?? null
}
