import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';

import {
  isReaction,
  normalizeUpsert,
  unwrapMessage,
  type EvolutionUpsert,
} from '@/lib/whatsapp/transport/evolution-inbound';
import { persistDeviceMessage, persistInboundMessage } from '@/lib/whatsapp/inbound-store';
import { resolveInboundEvolutionChannel } from '@/lib/cb-channels/resolve-inbound';
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { fetchAndStoreEvolutionMedia } from '@/lib/whatsapp/transport/evolution-media';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { decrypt } from '@/lib/whatsapp/encryption';

// Inbound processing fans out to flows / automations / AI, so give the
// after() block headroom beyond the platform default.
export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
  }
  return _adminClient;
}

/**
 * Evolution does NOT sign its webhooks, so authenticity rests on a shared
 * secret we set in the instance's webhook `headers` (Authorization:
 * Bearer <EVOLUTION_WEBHOOK_SECRET>). Constant-time compare; the echoed
 * `apikey`/`server_url` in the body are attacker-controllable and are NOT
 * trusted. Fail-closed when the secret isn't configured.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) return false;
  const presented = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Baileys ACK ints/enums → our messages.status ladder (CHECK-constrained).
function ackToStatus(status: unknown): 'sent' | 'delivered' | 'read' | null {
  const s = String(status).toUpperCase();
  if (s === 'SERVER_ACK' || s === '2') return 'sent';
  if (s === 'DELIVERY_ACK' || s === '3') return 'delivered';
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5') return 'read';
  return null;
}

interface EvolutionWebhookBody {
  event?: string;
  instance?: string;
  data?: unknown;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: EvolutionWebhookBody;
  try {
    body = (await request.json()) as EvolutionWebhookBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Config event names are UPPERCASE_SNAKE_CASE but the emitted `event`
  // field is lowercase dot-notation — match case-insensitively.
  const event = (body.event ?? '').toLowerCase().replace(/_/g, '.');
  const instance = body.instance;
  if (!instance) return NextResponse.json({ ok: true });

  // Route to the owning account/channel by instance name (the inbound key).
  // cb_channels first (multi-canal); falls back to whatsapp_config (the
  // single-channel flow) with a warning. Deploy-safe: unknown table → fallback.
  const route = await resolveInboundEvolutionChannel(supabaseAdmin(), instance);

  if (!route) {
    // Unknown/foreign instance — ack so Evolution doesn't retry forever.
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.upsert') {
    const items: EvolutionUpsert[] = Array.isArray(body.data)
      ? (body.data as EvolutionUpsert[])
      : [body.data as EvolutionUpsert];
    after(async () => {
      // DUAS FASES, de propósito — a separação é a correção, não estilo.
      //
      // Antes a mídia era baixada ANTES de gravar, e o comentário jurava que
      // falhar só custaria o anexo. Não custava: o download não tinha timeout,
      // então um servidor mudo consumia os 60s de `maxDuration` e a plataforma
      // matava o `after()` — a mensagem do cliente nunca chegava a existir.
      //
      // Gravar antes conserta o caso de UM item. Mas o lote pode ter vários, e
      // intercalar (gravar 1 → baixar 1 → gravar 2) faz o download lento do
      // primeiro consumir o orçamento e os SEGUINTES nunca serem gravados —
      // some a mensagem de novo, agora nos itens de trás.
      //
      // Fase 1 grava tudo; fase 2 busca os anexos. Assim o pior caso do
      // estouro de orçamento é ficar sem anexo, com todas as mensagens no
      // lugar. Perder o anexo é ruim; perder a mensagem é inaceitável.
      const semAnexo: {
        item: EvolutionUpsert;
        contentType: string;
        messageId: string;
      }[] = [];

      for (const item of items) {
        try {
          // Reação não é mensagem: vira estado em `message_reactions`,
          // pendurado na bolha da mensagem reagida.
          if (isReaction(item.message)) {
            await registrarReacao(item);
            continue;
          }

          const normalized = normalizeUpsert(
            item,
            route.accountId,
            route.ownerUserId,
            route.channelId,
          );
          if (!normalized) continue;

          if (await jaGravada(normalized.providerMessageId, normalized.fromMe)) continue;

          // `fromMe` que sobreviveu ao teste acima não é eco nosso — foi
          // digitado no celular pareado, que divide a conta de WhatsApp
          // com o CRM. Caminho separado: sem fan-out e sem não-lido.
          const gravada = normalized.fromMe
            ? await persistDeviceMessage(supabaseAdmin(), normalized)
            : await persistInboundMessage(supabaseAdmin(), normalized);

          if (gravada && normalized.contentType !== 'text' && !normalized.mediaUrl) {
            semAnexo.push({
              item,
              contentType: normalized.contentType,
              messageId: gravada.messageId,
            });
          }
        } catch (err) {
          console.error('[evolution/webhook] persist failed:', err);
        }
      }

      for (const pendente of semAnexo) {
        try {
          const mediaUrl = await resolveEvolutionMedia(
            route.accountId,
            route.channelId,
            pendente.item,
            pendente.contentType,
          );
          if (!mediaUrl) continue;
          const { error } = await supabaseAdmin()
            .from('messages')
            .update({ media_url: mediaUrl })
            .eq('id', pendente.messageId);
          if (error) {
            console.error(
              '[evolution/webhook] anexo baixado mas não pôde ser ligado à mensagem:',
              error.message,
            );
          }
        } catch (err) {
          // A mensagem já está gravada — aqui só se perde o anexo.
          console.error('[evolution/webhook] anexo falhou:', err);
        }
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (event === 'messages.update') {
    const d = (body.data ?? {}) as { keyId?: string; status?: unknown };
    const status = ackToStatus(d.status);
    if (d.keyId && status) {
      after(async () => {
        // Só toca nossas mensagens de saída (message_id === keyId). NÃO
        // escopamos por channel_id: o keyId da Baileys é único por mensagem,
        // então já mira exatamente a mensagem certa mesmo com vários canais —
        // e escopar por canal congelaria o ✓✓ das mensagens antigas
        // (channel_id NULL, anteriores à Fase 3).
        //
        // 'agent' é o envio manual do inbox; 'bot' é o que IA, flows e
        // automações gravam. Filtrar só por 'agent' deixava toda resposta
        // automática presa em "enviado", sem nunca virar entregue/lido.
        const { error } = await supabaseAdmin()
          .from('messages')
          .update({ status })
          .eq('message_id', d.keyId)
          .in('sender_type', ['agent', 'bot']);
        if (error) {
          console.error('[evolution/webhook] status update failed:', error);
          return;
        }

        // Fan-out do webhook público. O lado Meta já emite
        // message.status_updated; sem isto, quem integra recebe o ✓✓ dos
        // números oficiais e silêncio dos não-oficiais. Best-effort: uma
        // falha aqui não pode desfazer o UPDATE acima.
        const { data: msgRow } = await supabaseAdmin()
          .from('messages')
          .select('conversation_id, channel_id, conversations(account_id)')
          .eq('message_id', d.keyId)
          .in('sender_type', ['agent', 'bot'])
          .limit(1)
          .maybeSingle();

        const accountId = (
          msgRow?.conversations as { account_id: string } | null
        )?.account_id;
        if (msgRow && accountId) {
          await dispatchWebhookEvent(
            supabaseAdmin(),
            accountId,
            'message.status_updated',
            {
              whatsapp_message_id: d.keyId,
              conversation_id: msgRow.conversation_id,
              status,
              channel_id: msgRow.channel_id ?? null,
            },
          );
        }
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (event === 'connection.update') {
    const d = (body.data ?? {}) as { state?: string };
    const raw = d.state;
    const state = raw === 'open' || raw === 'connecting' ? raw : 'close';
    after(async () => {
      // Espelho whatsapp_config (canal padrão / fluxo single-channel).
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({
          instance_state: state,
          status: state === 'open' ? 'connected' : 'disconnected',
          ...(state === 'open' ? { last_connected_at: new Date().toISOString() } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('instance_name', instance);
      // cb_channels (multi-canal): mantém o status do canal fresco após
      // conexão/queda passiva — importante para o seletor da Fase 4. Best-
      // effort e deploy-safe (tabela ausente → erro ignorado). O CHECK de
      // cb_channels.status admite connected/connecting/disconnected (sem
      // 'close'), então 'close' → 'disconnected'.
      const { error: chErr } = await supabaseAdmin()
        .from('cb_channels')
        .update({
          status:
            state === 'open'
              ? 'connected'
              : state === 'connecting'
                ? 'connecting'
                : 'disconnected',
          ...(state === 'open' ? { connected_at: new Date().toISOString() } : {}),
        })
        .eq('instance_name', instance)
        .eq('kind', 'evolution');
      if (chErr) {
        console.warn(
          '[evolution/webhook] cb_channels status sync falhou (ignorado):',
          chErr.message,
        );
      }
    });
    return NextResponse.json({ ok: true });
  }

  // Any other event (qrcode.updated, send.message echo, …) — just ack.
  return NextResponse.json({ ok: true });
}

/**
 * A mensagem já está no banco? Faz dois trabalhos com uma consulta:
 *
 *  1. **Idempotência.** A Evolution REENTREGA o webhook quando não recebe
 *     200 a tempo, com o mesmo `key.id` da Baileys. Sem isto a mesma
 *     mensagem entra duas vezes no histórico — já aconteceu em produção.
 *  2. **Distinguir o eco do aparelho.** Tudo que sai desta conta chega com
 *     `fromMe`. Se o id já existe, foi o CRM que enviou (gravamos no
 *     momento do envio). Se não existe, foi digitado no celular.
 *
 * `esperarCorrida` cobre o intervalo em que o CRM já mandou para a
 * Evolution mas ainda não gravou a linha: o envio grava DEPOIS de receber
 * o id de volta, então o eco pode chegar primeiro. Sem essa espera, o
 * próprio envio do operador viraria uma segunda bolha "pelo celular".
 */
async function jaGravada(providerMessageId: string, esperarCorrida = false): Promise<boolean> {
  const existe = async () => {
    const { data } = await supabaseAdmin()
      .from('messages')
      .select('id')
      .eq('message_id', providerMessageId)
      .limit(1)
      .maybeSingle();
    return !!data;
  };

  if (await existe()) return true;
  if (!esperarCorrida) return false;

  await new Promise((r) => setTimeout(r, 2_000));
  return existe();
}

/**
 * Reação recebida (`👍` numa mensagem). Não é mensagem: vira estado em
 * `message_reactions`, a mesma tabela que o lado Meta e o botão de reagir
 * do inbox já usam, então a bolha exibe sem nenhuma mudança de UI.
 *
 * Texto vazio significa REMOÇÃO da reação, igual à especificação da Meta.
 *
 * ⚠️ Reação feita no CELULAR pareado é ignorada de propósito. A chave é
 * `(message_id, actor_type, actor_id)` e não há como saber QUAL usuário do
 * CRM reagiu pelo aparelho compartilhado — atribuir a um chute poria o
 * nome de uma pessoa numa ação que não foi dela.
 */
async function registrarReacao(item: EvolutionUpsert): Promise<void> {
  if (item.key?.fromMe) return;

  const reacao = unwrapMessage(item.message)?.reactionMessage as
    | { key?: { id?: string }; text?: unknown }
    | undefined;
  const alvoProviderId = reacao?.key?.id;
  if (!alvoProviderId) return;

  const { data: alvo } = await supabaseAdmin()
    .from('messages')
    .select('id, conversation_id, conversations(contact_id)')
    .eq('message_id', alvoProviderId)
    .limit(1)
    .maybeSingle();

  // Reação a mensagem anterior à integração: não há bolha onde pendurar.
  if (!alvo) return;
  const contactId = (alvo.conversations as { contact_id: string } | null)?.contact_id;
  if (!contactId) return;

  const emoji = typeof reacao?.text === 'string' ? reacao.text : '';

  if (!emoji) {
    const { error } = await supabaseAdmin()
      .from('message_reactions')
      .delete()
      .eq('message_id', alvo.id)
      .eq('actor_type', 'customer')
      .eq('actor_id', contactId);
    if (error) console.error('[evolution/webhook] remover reação falhou:', error.message);
    return;
  }

  const { error } = await supabaseAdmin().from('message_reactions').upsert(
    {
      message_id: alvo.id,
      conversation_id: alvo.conversation_id,
      actor_type: 'customer',
      actor_id: contactId,
      emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' },
  );
  if (error) console.error('[evolution/webhook] gravar reação falhou:', error.message);
}

/**
 * Monta o client da Evolution a partir das credenciais do canal e baixa a
 * midia. Devolve `null` (e nunca lanca) quando o canal nao resolve ou o
 * download falha — o chamador persiste a mensagem sem anexo.
 */
async function resolveEvolutionMedia(
  accountId: string,
  channelId: string | null,
  rawItem: unknown,
  contentType: string,
): Promise<string | null> {
  try {
    const canal = await resolveChannelForConversation(supabaseAdmin(), accountId, {
      channel_id: channelId,
    });
    if (!canal || canal.provider !== 'evolution') return null;
    if (!canal.base_url || !canal.instance_name || !canal.api_key) return null;

    const client = new EvolutionClient({
      baseUrl: canal.base_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });
    return await fetchAndStoreEvolutionMedia({
      db: supabaseAdmin(),
      client,
      accountId,
      // O item CRU do webhook (`{key, message, …}`), não o `.message` de
      // dentro dele. A Evolution faz `const msg = m?.message ? m :
      // getMessage(m.key)`: mandando só o conteúdo, `m.message` é undefined,
      // ela tenta o lookup por `m.key` — que não existe no que enviamos — e
      // devolve 400. Era por isso que NENHUM anexo recebido era baixado.
      rawMessage: rawItem,
      contentType,
    });
  } catch (err) {
    console.error(
      '[evolution/webhook] midia recebida nao pode ser salva:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
