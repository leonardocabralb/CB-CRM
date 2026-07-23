// ============================================================
// Resolvedor de canal para o ENVIO.
//
// Ponto único que decide "por qual número esta conversa responde".
// Substitui o `whatsapp_config … .single()` que o envio fazia direto
// (send-message.ts) — sem mudar o comportamento enquanto só existir o
// canal padrão: toda conversa tem `channel_id` NULL, resolve para o
// canal `is_default` da conta, que o backfill da 901 espelhou de
// `whatsapp_config`.
//
// ORDEM DE RESOLUÇÃO
//   1. `conversations.channel_id` — canal fixado/escolhido na conversa.
//   2. canal `is_default` da conta.
//   3. FALLBACK de transição: lê `whatsapp_config` direto (comportamento
//      antigo), com aviso. Cobre o intervalo entre subir este código e
//      aplicar a migration 901 — e qualquer conta sem canal ainda.
//
// SEGURO PARA DEPLOY FORA DE ORDEM: as consultas a `cb_channels`
// ignoram o erro do PostgREST (tabela inexistente → data null), então
// se este código subir antes da 901 rodar, ele simplesmente cai no
// fallback de `whatsapp_config` em vez de quebrar o envio.
//
// A resolução por "último inbound" (seguir o número que o cliente usou
// por último) entra na Fase 3, quando as mensagens passam a carimbar
// `channel_id`. Aqui ainda não há o que seguir.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Conexão resolvida, já no formato que o `send-message.ts` consome. Os
 * campos de credencial mantêm os MESMOS nomes de `whatsapp_config`
 * (`access_token`, `phone_number_id`, `base_url`, `instance_name`,
 * `api_key`) para o call-site mudar o mínimo — `access_token`/`api_key`
 * continuam CRIPTOGRAFADOS (o chamador decripta).
 */
export interface ResolvedChannel {
  provider: 'meta' | 'evolution';
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  base_url: string | null;
  instance_name: string | null;
  api_key: string | null;
  /** `cb_channels.id` do canal resolvido; NULL no fallback legado. */
  channelId: string | null;
  /** `whatsapp_config.id` — alvo do self-heal de token legado (Meta). */
  legacyConfigId: string | null;
  source: 'cb_channels' | 'whatsapp_config';
}

// Server-side: inclui os segredos (não é o SAFE_COLUMNS do client).
const CHANNEL_COLS =
  'id, kind, is_default, phone_number_id, waba_id, access_token, ' +
  'server_url, instance_name, api_key';

interface ChannelRow {
  id: string;
  kind: string;
  phone_number_id: string | null;
  waba_id: string | null;
  access_token: string | null;
  server_url: string | null;
  instance_name: string | null;
  api_key: string | null;
}

function mapChannelRow(row: ChannelRow): ResolvedChannel {
  return {
    provider: row.kind === 'evolution' ? 'evolution' : 'meta',
    phone_number_id: row.phone_number_id ?? null,
    waba_id: row.waba_id ?? null,
    access_token: row.access_token ?? null,
    base_url: row.server_url ?? null,
    instance_name: row.instance_name ?? null,
    api_key: row.api_key ?? null,
    channelId: row.id,
    legacyConfigId: null,
    source: 'cb_channels',
  };
}

/**
 * Resolve a conexão por onde a conversa deve responder. Devolve `null`
 * quando a conta não tem NENHUMA conexão (nem canal, nem
 * `whatsapp_config`) — o chamador traduz isso no seu próprio erro
 * "WhatsApp não configurado".
 */
export async function resolveChannelForConversation(
  db: SupabaseClient,
  accountId: string,
  conversation: { channel_id?: string | null } | null,
): Promise<ResolvedChannel | null> {
  let row: ChannelRow | null = null;

  // 1. Canal explícito da conversa.
  const channelId = conversation?.channel_id ?? null;
  if (channelId) {
    const { data } = await db
      .from('cb_channels')
      .select(CHANNEL_COLS)
      .eq('id', channelId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (data) row = data as ChannelRow;
  }

  // 2. Canal padrão da conta.
  if (!row) {
    const { data } = await db
      .from('cb_channels')
      .select(CHANNEL_COLS)
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle();
    if (data) row = data as ChannelRow;
  }

  if (row) return mapChannelRow(row);

  // 3. Fallback de transição: whatsapp_config direto.
  const { data: cfg } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (!cfg) return null;

  console.warn(
    '[cb-channels] conversa sem canal em cb_channels; usando whatsapp_config (fallback de transição)',
  );
  return {
    provider: cfg.provider === 'evolution' ? 'evolution' : 'meta',
    phone_number_id: cfg.phone_number_id ?? null,
    waba_id: cfg.waba_id ?? null,
    access_token: cfg.access_token ?? null,
    base_url: cfg.base_url ?? null,
    instance_name: cfg.instance_name ?? null,
    api_key: cfg.api_key ?? null,
    channelId: null,
    legacyConfigId: cfg.id,
    source: 'whatsapp_config',
  };
}
