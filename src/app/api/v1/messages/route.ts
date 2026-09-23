// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // required; telefoneDigitado (docs/public-api.md#phone-numbers)
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe",                    // optional, names a newly-created contact
//     "channel_id": "<uuid>"                 // optional, which of the account's WhatsApp
//                                            // numbers to send from. Omitted = the channel
//                                            // the conversation is already on, else the
//                                            // account default. Listable via GET /api/v1/channels.
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created", "channel_id" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import { pinConversationChannel } from '@/lib/cb-channels/stamp';
import { ehWhatsApp } from '@/lib/cb-channels/transporte';
import { ehUuid } from '@/lib/tasks/validar';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    if (!to) {
      return fail('bad_request', "'to' is required", 400);
    }

    const type = typeof body.type === 'string' ? body.type : 'text';

    // Unpack the optional `template` object into the flat params the
    // send core expects. `params` as an array → legacy positional body
    // params; as an object → structured header/body/button params.
    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // Validated by `validateSendMessageParams` below; the cast just bridges
    // the untyped JSON body to the send-core param type.
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    // O canal pedido é conferido AQUI, antes de achar-ou-criar o contato e
    // antes de fixar. ⚠️ Uma conta do INSTAGRAM é conexão desta conta (e
    // `GET /api/v1/channels` a lista), então `pinConversationChannel`, que só
    // confere a posse, a FIXAVA na conversa do telefone — e só depois o núcleo
    // recusava com `not_supported`. A conversa ficava presa no Instagram, e
    // todo envio seguinte (tela ou API) falhava até alguém trocar o canal à
    // mão. Mesmo código e status de antes; só o efeito colateral sai.
    const channelId =
      typeof body.channel_id === 'string' ? body.channel_id.trim() : '';
    if (channelId) {
      // Sem a forma de UUID o Postgres recusa o filtro (22P02) e a leitura
      // viraria 500 — antes era o 400 abaixo, e continua sendo.
      if (!ehUuid(channelId)) {
        return fail(
          'bad_request',
          "'channel_id' is not a channel of this account",
          400
        );
      }
      const { data: canal, error: erroDoCanal } = await ctx.supabase
        .from('cb_channels')
        .select('id, kind')
        .eq('id', channelId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      // Erro de banco NÃO é "não encontrado".
      if (erroDoCanal) {
        console.error(
          '[api/v1/messages] leitura do canal falhou:',
          erroDoCanal.message
        );
        return fail('internal', 'Failed to verify the channel', 500);
      }
      if (!canal) {
        return fail(
          'bad_request',
          "'channel_id' is not a channel of this account",
          400
        );
      }
      if (!ehWhatsApp(canal)) {
        return fail(
          'not_supported',
          "'channel_id' is not a WhatsApp number: this endpoint sends through the account's WhatsApp numbers only",
          400
        );
      }
    }

    // Find-or-create the conversation for this phone, then send. Both
    // steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      typeof body.name === 'string' ? body.name : null
    );

    // Canal explícito (multi-canal). Sem isto o número remetente é
    // imprevisível para quem integra: o envio herda o canal da conversa, que
    // "segue o cliente" — um lembrete de audiência sairia pelo celular pessoal
    // do sócio só porque o cliente respondeu por lá na semana passada.
    // FIXAR (e não só usar uma vez) é deliberado: a resposta do cliente volta
    // pelo mesmo número que ele viu. (A posse e o transporte já foram
    // conferidos lá em cima; o pin confere a posse de novo porque o canal
    // pode ter sido apagado no meio.)
    if (channelId) {
      const pinned = await pinConversationChannel(
        ctx.supabase,
        ctx.accountId,
        resolved.conversationId,
        channelId
      );
      if (!pinned) {
        return fail(
          'bad_request',
          "'channel_id' is not a channel of this account",
          400
        );
      }
    }

    // ⚠️ SEM `senderUserId`, de propósito. Aqui quem autentica é uma CHAVE DE
    // API: `ctx` não tem `user` porque não houve pessoa. `messages.sender_id`
    // fica nulo, que é a informação verdadeira — "não foi ninguém desta
    // equipe". Não substituir pelo dono da conta nem pelo criador da chave:
    // isso inventaria um autor que não apertou nada, e é justamente o que a
    // coluna existe para desmentir.
    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: typeof body.text === 'string' ? body.text : null,
        mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName: typeof template?.name === 'string' ? template.name : null,
        templateLanguage:
          typeof template?.language === 'string' ? template.language : null,
        templateParams,
        templateMessageParams,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === 'string'
            ? body.reply_to_message_id
            : null,
      }
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
        // Por qual número saiu de fato — sem isto quem integra não tem como
        // auditar o remetente depois.
        channel_id: result.channelId,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
