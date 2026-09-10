// ============================================================
// O app da Meta da conta (990): Instagram App ID + Instagram App Secret,
// cadastrados UMA vez. É o que o login do Instagram (OAuth) precisa antes de
// existir qualquer canal, e o que o caminho do token colado reaproveita em
// vez de pedir o segredo de novo. Só servidor: a tabela é fechada ao
// navegador e o segredo sai daqui DECIFRADO — quem chama decide o que
// devolver à tela (a rota devolve só o App ID).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Espelho do CHECK da 990. */
export const APP_ID_VALIDO = /^[0-9]{5,32}$/;

export interface AppDoInstagram {
  appId: string;
  /** DECIFRADO. Nunca devolver à tela. */
  appSecret: string;
  atualizadoEm: string | null;
}

export async function lerAppDoInstagram(
  admin: SupabaseClient,
  accountId: string
): Promise<AppDoInstagram | null> {
  const { data, error } = await admin
    .from('cb_instagram_config')
    .select('ig_app_id, ig_app_secret, updated_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao ler o app do Instagram: ${error.message}`);
  }
  if (!data) return null;

  let appSecret: string;
  try {
    appSecret = decrypt(String(data.ig_app_secret));
  } catch {
    // ENCRYPTION_KEY rotacionada: o app precisa ser cadastrado de novo.
    throw new Error('O segredo do app do Instagram não pôde ser decifrado.');
  }
  return {
    appId: String(data.ig_app_id),
    appSecret,
    atualizadoEm: typeof data.updated_at === 'string' ? data.updated_at : null,
  };
}

/**
 * Grava (ou troca) o app. `appSecret: null` = só o App ID mudou e o segredo
 * guardado fica — devolve `sem_app` quando não há linha, porque config sem
 * segredo não serve para nada.
 */
export async function gravarAppDoInstagram(
  admin: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    appId: string;
    appSecret: string | null;
  }
): Promise<'gravado' | 'sem_app'> {
  const agora = new Date().toISOString();
  if (args.appSecret === null) {
    const { data, error } = await admin
      .from('cb_instagram_config')
      .update({ ig_app_id: args.appId, updated_at: agora })
      .eq('account_id', args.accountId)
      .select('account_id');
    if (error) {
      throw new Error(`Falha ao atualizar o app do Instagram: ${error.message}`);
    }
    return data && data.length > 0 ? 'gravado' : 'sem_app';
  }
  const { error } = await admin.from('cb_instagram_config').upsert(
    {
      account_id: args.accountId,
      ig_app_id: args.appId,
      ig_app_secret: encrypt(args.appSecret),
      created_by: args.userId,
      updated_at: agora,
    },
    { onConflict: 'account_id' }
  );
  if (error) {
    throw new Error(`Falha ao gravar o app do Instagram: ${error.message}`);
  }
  return 'gravado';
}
