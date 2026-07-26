// ============================================================
// Canal para os ENGINES (fluxos, automações, auto-reply de IA, reações).
//
// Os senders dos engines liam `whatsapp_config` direto — numa conversa
// Evolution isso enviava (ou quebrava) sempre pelo Meta padrão. Estes
// helpers espelham o padrão do send-message.ts (o caminho manual,
// channel-aware desde a Fase 1): resolver o canal da CONVERSA e, quando
// for Evolution, construir o transport correspondente.
//
// SEGURO PARA DEPLOY FORA DE ORDEM: a leitura de conversations.channel_id
// engole o erro pré-902 (coluna ausente → null) e resolveChannelForConversation
// já engole a ausência de cb_channels (pré-901 → fallback whatsapp_config).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import {
  getTransport,
  toEvolutionNumber,
  type WhatsAppTransport,
} from '@/lib/whatsapp/transport';
import {
  resolveChannelForConversation,
  type ResolvedChannel,
} from './resolve';

/**
 * Resolve o canal por onde uma conversa responde, a partir do id da
 * conversa (os engines não carregam a linha). Ordem: canal fixado/seguido
 * da conversa → canal padrão da conta → fallback whatsapp_config.
 */
export async function resolveEngineChannel(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ResolvedChannel | null> {
  const { data } = await db
    .from('conversations')
    .select('channel_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  // Erro (pré-902) ou conversa sem canal → data null → resolve pelo padrão.
  return resolveChannelForConversation(
    db,
    accountId,
    (data as { channel_id?: string | null } | null) ?? null,
  );
}

/**
 * Como {@link resolveEngineChannel}, mas com um canal PREFERIDO — o do
 * passo/nó (escolha explícita do operador) ou o do DISPARO (o número por
 * onde o cliente escreveu).
 *
 * Existe para separar "por onde a conversa está agora" de "por onde ESTE
 * envio deve sair". Sem essa distinção, um follow-up agendado às 9h saía às
 * 15h pelo número que o cliente usou no meio-tempo, e não havia como dizer
 * "a confirmação formal sai SEMPRE pelo número oficial".
 *
 * Um `preferredChannelId` inexistente ou de outra conta NÃO é erro: cai no
 * comportamento normal (canal da conversa → padrão → espelho). O filtro por
 * `account_id` em resolveChannelForConversation é o que barra o vazamento
 * entre contas.
 */
export async function resolveEngineChannelPreferring(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  preferredChannelId: string | null | undefined,
): Promise<ResolvedChannel | null> {
  if (preferredChannelId) {
    const escolhido = await resolveChannelForConversation(db, accountId, {
      channel_id: preferredChannelId,
    });
    // Só aceita se o canal pedido REALMENTE resolveu — senão o resolve já
    // teria caído no padrão, e aí é melhor seguir o caminho da conversa.
    if (escolhido?.channelId === preferredChannelId) return escolhido;
  }
  return resolveEngineChannel(db, accountId, conversationId);
}

/**
 * Transport da Evolution para um canal resolvido. Lança com mensagem
 * clara quando o canal está incompleto (o run/log do engine a registra).
 */
export function evolutionTransportFor(
  channel: ResolvedChannel,
): WhatsAppTransport {
  if (!channel.base_url || !channel.instance_name || !channel.api_key) {
    throw new Error(
      'Evolution connection is incomplete — reconnect WhatsApp in Settings.',
    );
  }
  return getTransport({
    provider: 'evolution',
    baseUrl: channel.base_url,
    instance: channel.instance_name,
    apikey: decrypt(channel.api_key),
  });
}

/** JID do destinatário, persistido em messages.remote_jid para reações/
 *  respostas reconstruírem a chave Baileys depois. */
export function evolutionRemoteJid(phoneE164: string): string {
  return `${toEvolutionNumber(phoneE164)}@s.whatsapp.net`;
}
