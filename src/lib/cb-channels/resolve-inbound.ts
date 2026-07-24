// ============================================================
// Resolvedor de canal para a ENTRADA (inbound).
//
// O webhook recebe apenas a CHAVE de roteamento — instance_name (Evolution)
// ou phone_number_id (Meta) — nunca a conta. Estes helpers a traduzem no
// canal `cb_channels` correspondente.
//
// ADITIVO, não uma reescrita: a infraestrutura da Meta continua resolvendo
// conta/token por `whatsapp_config` exatamente como antes. `resolveInbound-
// MetaChannelId` só ADICIONA a descoberta do `channel_id` para carimbar a
// mensagem — é a peça mínima que habilita mais de um número Meta sem mexer no
// fluxo que já funciona.
//
// SEGURO PARA DEPLOY FORA DE ORDEM: as consultas a `cb_channels` ignoram o
// erro do PostgREST (tabela inexistente → data null), então se este código
// subir antes da migration 901, o roteamento Evolution cai no fallback
// `whatsapp_config` (o comportamento single-channel do Gabriel) e o carimbo
// Meta simplesmente não acontece — nada quebra.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface InboundEvolutionRoute {
  accountId: string;
  /** Dono de registro para inserts NOT NULL (contatos/conversas). */
  ownerUserId: string;
  /** `cb_channels.id`; NULL no fallback `whatsapp_config` (transição). */
  channelId: string | null;
}

/**
 * Descobre conta / dono / canal de uma instância Evolution que entregou um
 * webhook. Tenta `cb_channels` (multi-canal) e cai em `whatsapp_config`
 * (single-channel do Gabriel / transição) com aviso. Retorna `null` quando a
 * instância é desconhecida (o webhook então só dá ack para não reenviar).
 */
export async function resolveInboundEvolutionChannel(
  db: SupabaseClient,
  instanceName: string,
): Promise<InboundEvolutionRoute | null> {
  // 1. cb_channels por instance_name (chave de roteamento única global).
  const { data: channel } = await db
    .from('cb_channels')
    .select('id, account_id, created_by')
    .eq('instance_name', instanceName)
    .eq('kind', 'evolution')
    .maybeSingle();

  if (channel) {
    let ownerUserId: string | null = channel.created_by ?? null;
    if (!ownerUserId) {
      // created_by anulado (membro removido, ON DELETE SET NULL) — cai para
      // o dono do espelho whatsapp_config da conta.
      const { data: wc } = await db
        .from('whatsapp_config')
        .select('user_id')
        .eq('account_id', channel.account_id)
        .maybeSingle();
      ownerUserId = wc?.user_id ?? null;
    }
    if (!ownerUserId) {
      console.error(
        '[cb-channels] canal Evolution sem dono resolvível (created_by e whatsapp_config.user_id nulos); mensagem descartada:',
        instanceName,
      );
      return null;
    }
    return { accountId: channel.account_id, ownerUserId, channelId: channel.id };
  }

  // 2. Fallback de transição: whatsapp_config por instance_name (Gabriel).
  const { data: cfg } = await db
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('instance_name', instanceName)
    .eq('provider', 'evolution')
    .maybeSingle();

  if (cfg) {
    console.warn(
      '[cb-channels] instância só em whatsapp_config; roteando pelo fallback de transição:',
      instanceName,
    );
    return {
      accountId: cfg.account_id,
      ownerUserId: cfg.user_id,
      channelId: null,
    };
  }

  return null;
}

/**
 * `cb_channels.id` do canal Meta que atende um `phone_number_id`, para
 * carimbar `messages.channel_id`. NULL quando não há canal (ou antes da 901).
 *
 * ADITIVO: o webhook Meta continua resolvendo conta e token por
 * `whatsapp_config` como sempre — isto só acrescenta o carimbo de canal, que
 * é o que permite distinguir mensagens de diferentes números Meta.
 */
export async function resolveInboundMetaChannelId(
  db: SupabaseClient,
  phoneNumberId: string,
): Promise<string | null> {
  const { data } = await db
    .from('cb_channels')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .eq('kind', 'meta')
    .maybeSingle();
  return data?.id ?? null;
}
