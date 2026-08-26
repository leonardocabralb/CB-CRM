import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { sendReactionMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils';
import {
  resolveEngineChannel,
  evolutionTransportFor,
} from '@/lib/cb-channels/engine-send';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Sends the reaction to Meta and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions are handled by the
 * webhook — this route only writes `actor_type = 'agent'` rows.
 */
export async function POST(request: Request) {
  try {
    // Reacting is a write operation (`canSendMessages`), and it pushes the
    // reaction to Meta before mirroring it locally — so, as on /send, a
    // missing role check let a read-only viewer put a visible reaction on
    // the customer's message even though RLS blocked the local mirror.
    const { supabase, accountId, userId } = await requireRole('agent');

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

      // Nota de merge (upstream #448): o `requireRole('agent')` acima exige
      // exatamente o mesmo papel que o nosso `barrarPorPapel` exigia aqui, e
      // ainda resolve o account_id. O bloco saiu por redundancia, nao por
      // abrir mao da guarda.
    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== 'string') {
      return NextResponse.json(
        { error: 'message_id and emoji are required' },
        { status: 400 },
      );
    }

    // Resolve target message + its conversation; verify ownership.
    const { data: targetMessage, error: msgError } = await supabase
      .from('messages')
      .select('id, message_id, conversation_id, remote_jid, from_me')
      .eq('id', message_id)
      .maybeSingle();

    if (msgError || !targetMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      // No Meta ID yet — usually a sending/failed agent message. We can't
      // tell Meta to react to a message it never received.
      return NextResponse.json(
        { error: 'Cannot react to a message that has not been sent to WhatsApp' },
        { status: 400 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id, group_id, contact:contacts(phone)')
      .eq('id', targetMessage.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 },
      );
    }

    // Reagir em grupo ficou fora do v1: a chave da Baileys precisa do
    // `participant` de quem escreveu, e `message_reactions` guarda o autor
    // como `contact_id` — que em grupo é NULL. Sem os dois, a reação não tem
    // nem destinatário nem autor. A UI esconde o botão; isto é a 2a tranca.
    if (conversation.group_id) {
      return NextResponse.json(
        { error: 'Reactions are not supported in group conversations yet' },
        { status: 400 },
      );
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    // Canal da conversa (multi-canal, Fase 5): a reação sai pelo MESMO
    // número da conversa — Meta via Graph, Evolution via transport
    // (Baileys, que precisa da chave completa remote_jid/from_me/id).
    const channel = await resolveEngineChannel(supabase, accountId, conversation.id);
    if (!channel) {
      return NextResponse.json(
        { error: 'WhatsApp not configured.' },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    if (channel.provider === 'evolution') {
      try {
        const transport = evolutionTransportFor(channel);
        await transport.sendReaction({
          target: {
            id: targetMessage.message_id,
            remoteJid: targetMessage.remote_jid ?? undefined,
            fromMe: targetMessage.from_me ?? undefined,
          },
          emoji,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown Evolution error';
        console.error('[whatsapp/react] Evolution send failed:', message);
        return NextResponse.json(
          { error: `Evolution API error: ${message}` },
          { status: 502 },
        );
      }
    } else {
      if (!channel.phone_number_id || !channel.access_token) {
        return NextResponse.json(
          { error: 'WhatsApp not configured.' },
          { status: 400 },
        );
      }
      const accessToken = decrypt(channel.access_token);

      try {
        await sendReactionMessage({
          phoneNumberId: channel.phone_number_id,
          accessToken,
          to: sanitizedPhone,
          targetMessageId: targetMessage.message_id,
          emoji,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unknown Meta API error';
        console.error('[whatsapp/react] Meta send failed:', message);
        return NextResponse.json(
          { error: `Meta API error: ${message}` },
          { status: 502 },
        );
      }
    }

    // Mirror into DB. Empty emoji = removal.
    if (emoji === '') {
      const { error: delError } = await supabase
        .from('message_reactions')
        .delete()
        .eq('message_id', targetMessage.id)
        .eq('actor_type', 'agent')
        .eq('actor_id', userId);

      if (delError) {
        console.error('[whatsapp/react] DB delete failed:', delError.message);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB delete failed' },
          { status: 500 },
        );
      }
    } else {
      // Upsert. The unique constraint (message_id, actor_type, actor_id)
      // lets us swap emoji in a single statement.
      const { error: upsertError } = await supabase.from('message_reactions').upsert(
        {
          message_id: targetMessage.id,
          conversation_id: targetMessage.conversation_id,
          actor_type: 'agent',
          actor_id: userId,
          emoji,
        },
        { onConflict: 'message_id,actor_type,actor_id' },
      );

      if (upsertError) {
        console.error('[whatsapp/react] DB upsert failed:', upsertError.message);
        return NextResponse.json(
          { error: 'Reaction sent to Meta but DB upsert failed' },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error('Error in WhatsApp react POST:', error);
    return toErrorResponse(error);
  }
}
