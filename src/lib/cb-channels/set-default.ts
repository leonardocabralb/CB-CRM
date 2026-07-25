// ============================================================
// Promover um canal a PADRÃO da conta.
//
// São DUAS verdades a mover, não uma: o flag `cb_channels.is_default` e o
// espelho `whatsapp_config`. Enquanto broadcast, sync de templates, proxy de
// mídia e API v1 lerem o espelho, promover só o canal criaria drift
// silencioso — o painel mostraria um canal e o envio usaria outro.
//
// O flag é trocado em DOIS UPDATEs (limpa o antigo, marca o novo), nunca em
// um só: `cb_channels_one_default_idx` é índice único PARCIAL sobre
// (account_id) WHERE is_default, então marcar o novo antes de limpar o antigo
// violaria o índice. Na janela entre os dois a conta fica sem padrão, e
// `resolveChannelForConversation` cai no espelho — o envio segue funcionando.
//
// ⚠️ O espelho tem CHECK de tabela (`whatsapp_config_provider_fields_check`):
// provider='meta' exige phone_number_id + access_token; provider='evolution'
// exige base_url + instance_name + api_key. Como é um OR, zerar as colunas do
// OUTRO tipo é seguro — e necessário, para não deixar credencial órfã do
// provider anterior no espelho.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { getChannelWithSecrets, type CbChannelWithSecrets } from './repo';

export type SetDefaultResult =
  | { ok: true; alreadyDefault: boolean; mirrorWarning: string | null }
  | {
      ok: false;
      code: 'not_found' | 'incomplete' | 'flag_failed';
      message: string;
    };

/** O canal tem credenciais suficientes para ser o padrão da conta? */
function missingCredential(channel: CbChannelWithSecrets): string | null {
  if (channel.kind === 'meta') {
    if (!channel.phone_number_id || !channel.access_token) {
      return 'Este canal Meta está incompleto (falta Phone Number ID ou Access Token). Reconecte-o antes de torná-lo padrão.';
    }
    return null;
  }
  if (channel.kind === 'evolution') {
    if (!channel.server_url || !channel.instance_name || !channel.api_key) {
      return 'Este canal está incompleto (falta servidor, instância ou chave). Reconecte-o antes de torná-lo padrão.';
    }
    return null;
  }
  return 'Tipo de canal desconhecido.';
}

/**
 * Reescreve o espelho `whatsapp_config` a partir do canal recém-promovido.
 * Best-effort: devolve o aviso em vez de lançar — o flag já foi trocado e
 * desfazê-lo seria pior do que sinalizar a dessincronia.
 */
async function rewriteMirror(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  channel: CbChannelWithSecrets,
): Promise<string | null> {
  const nowIso = new Date().toISOString();
  const connected = channel.status === 'connected';

  // Shape único e explícito: as duas ramificações listam TODAS as colunas,
  // deixando o zeramento do outro provider visível em vez de implícito.
  interface MirrorRow {
    account_id: string;
    user_id: string;
    provider: 'meta' | 'evolution';
    phone_number_id: string | null;
    waba_id: string | null;
    access_token: string | null;
    verify_token: string | null;
    base_url: string | null;
    instance_name: string | null;
    api_key: string | null;
    instance_state: string | null;
    status: string;
    connected_at: string | null;
    last_connected_at: string | null;
    updated_at: string;
  }

  const comum = {
    account_id: accountId,
    user_id: userId,
    status: connected ? 'connected' : 'disconnected',
    connected_at: channel.connected_at,
    updated_at: nowIso,
  };

  const row: MirrorRow =
    channel.kind === 'meta'
      ? {
          ...comum,
          provider: 'meta',
          phone_number_id: channel.phone_number_id,
          waba_id: channel.waba_id ?? null,
          access_token: channel.access_token,
          verify_token: channel.verify_token ?? null,
          // Zera o lado Evolution: o CHECK é um OR, então isto é seguro, e
          // evita que resolve-inbound case um instance_name órfão pelo espelho.
          base_url: null,
          instance_name: null,
          api_key: null,
          instance_state: null,
          last_connected_at: null,
        }
      : {
          ...comum,
          provider: 'evolution',
          base_url: channel.server_url,
          instance_name: channel.instance_name,
          api_key: channel.api_key,
          instance_state: connected ? 'open' : 'close',
          last_connected_at: channel.connected_at,
          // Zera o lado Meta. phone_number_id tem índice único (013) — deixá-lo
          // preenchido bloquearia outra conta de cadastrar o mesmo número.
          phone_number_id: null,
          waba_id: null,
          access_token: null,
          verify_token: null,
        };

  const { error } = await db
    .from('whatsapp_config')
    .upsert(row, { onConflict: 'account_id' });

  if (error) {
    console.error(
      '[cb-channels] espelho whatsapp_config não acompanhou a promoção:',
      error.message,
    );
    return 'O canal virou padrão, mas o espelho de compatibilidade não foi atualizado. Broadcasts e modelos podem continuar usando o canal anterior — tente novamente.';
  }
  return null;
}

/**
 * Torna `channelId` o canal padrão da conta, movendo o espelho junto.
 * Idempotente: promover o canal que já é padrão apenas reescreve o espelho.
 */
export async function setDefaultChannel(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  channelId: string,
): Promise<SetDefaultResult> {
  const channel = await getChannelWithSecrets(db, accountId, channelId);
  if (!channel) {
    return { ok: false, code: 'not_found', message: 'Canal não encontrado.' };
  }

  const missing = missingCredential(channel);
  if (missing) {
    return { ok: false, code: 'incomplete', message: missing };
  }

  if (channel.is_default) {
    // Já é o padrão — só ressincroniza o espelho, que é justamente o caso de
    // recuperação quando uma promoção anterior falhou no meio.
    const mirrorWarning = await rewriteMirror(db, accountId, userId, channel);
    return { ok: true, alreadyDefault: true, mirrorWarning };
  }

  // 1) Limpa o padrão atual. Nunca viola o índice parcial.
  const { error: clearError } = await db
    .from('cb_channels')
    .update({ is_default: false })
    .eq('account_id', accountId)
    .eq('is_default', true);

  if (clearError) {
    return {
      ok: false,
      code: 'flag_failed',
      message: 'Não foi possível liberar o canal padrão atual.',
    };
  }

  // 2) Marca o novo. Se falhar, a conta fica temporariamente sem padrão — o
  //    envio cai no espelho e o operador pode repetir a operação.
  const { error: setError } = await db
    .from('cb_channels')
    .update({ is_default: true })
    .eq('id', channelId)
    .eq('account_id', accountId);

  if (setError) {
    console.error(
      '[cb-channels] promoção falhou depois de limpar o padrão anterior:',
      setError.message,
    );
    return {
      ok: false,
      code: 'flag_failed',
      message:
        'A conta ficou sem canal padrão ao trocar. Tente novamente para concluir.',
    };
  }

  const mirrorWarning = await rewriteMirror(db, accountId, userId, {
    ...channel,
    is_default: true,
  });
  return { ok: true, alreadyDefault: false, mirrorWarning };
}
