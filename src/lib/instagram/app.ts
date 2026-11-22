// ============================================================
// O app da Meta da conta (990), cadastrado UMA vez. É o que o login precisa
// antes de existir qualquer canal, e o que o caminho do token colado
// reaproveita em vez de pedir o segredo de novo. Só servidor: a tabela é
// fechada ao navegador e o segredo sai daqui DECIFRADO — quem chama decide o
// que devolver à tela (a rota devolve só o App ID e o ID da configuração).
//
// Dois tipos de app (1153), um por conta:
//   · `instagram` — o app antigo, com a aba "Configuração da API com login do
//     Instagram": Instagram App ID + Instagram App Secret;
//   · `unificado` — o app de hoje (app novo na Meta já não tem a aba antiga,
//     medido em 21/11/2026): App ID e App Secret PRINCIPAIS (Configurações do
//     app → Básico) + o ID da configuração do login unificado.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt, encrypt } from '@/lib/whatsapp/encryption';

/** Espelho do CHECK da 990 (e do `config_id`, 1153). */
export const APP_ID_VALIDO = /^[0-9]{5,32}$/;
export const CONFIG_ID_VALIDO = APP_ID_VALIDO;

export const LOGINS_DO_APP = ['instagram', 'unificado'] as const;
export type LoginDoApp = (typeof LOGINS_DO_APP)[number];

export function loginDoApp(valor: unknown): LoginDoApp | null {
  return (LOGINS_DO_APP as readonly unknown[]).includes(valor)
    ? (valor as LoginDoApp)
    : null;
}

export interface AppDoInstagram {
  login: LoginDoApp;
  appId: string;
  /** DECIFRADO. Nunca devolver à tela. */
  appSecret: string;
  /** Só no `unificado`. */
  configId: string | null;
  atualizadoEm: string | null;
}

export async function lerAppDoInstagram(
  admin: SupabaseClient,
  accountId: string
): Promise<AppDoInstagram | null> {
  const { data, error } = await admin
    .from('cb_instagram_config')
    .select('ig_app_id, ig_app_secret, login, config_id, updated_at')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) {
    throw new Error(`Falha ao ler o app do Instagram: ${error.message}`);
  }
  if (!data) return null;

  const login = loginDoApp(data.login);
  if (!login) {
    throw new Error(`Tipo de app do Instagram desconhecido: ${String(data.login)}`);
  }
  let appSecret: string;
  try {
    appSecret = decrypt(String(data.ig_app_secret));
  } catch {
    // ENCRYPTION_KEY rotacionada: o app precisa ser cadastrado de novo.
    throw new Error('O segredo do app do Instagram não pôde ser decifrado.');
  }
  return {
    login,
    appId: String(data.ig_app_id),
    appSecret,
    configId:
      login === 'unificado' && typeof data.config_id === 'string'
        ? data.config_id
        : null,
    atualizadoEm: typeof data.updated_at === 'string' ? data.updated_at : null,
  };
}

/**
 * Grava (ou troca) o app. `appSecret: null` = o segredo guardado fica — e só
 * vale para o MESMO tipo de app: o segredo do login do Instagram não serve ao
 * unificado, e vice-versa. Sem linha do mesmo tipo, devolve `sem_app` (quem
 * chama pede o segredo).
 */
export async function gravarAppDoInstagram(
  admin: SupabaseClient,
  args: {
    accountId: string;
    userId: string;
    login: LoginDoApp;
    appId: string;
    appSecret: string | null;
    /** Obrigatório no `unificado`; ignorado no `instagram`. */
    configId: string | null;
  }
): Promise<'gravado' | 'sem_app'> {
  const agora = new Date().toISOString();
  const configId = args.login === 'unificado' ? args.configId : null;
  if (args.appSecret === null) {
    const { data, error } = await admin
      .from('cb_instagram_config')
      .update({ ig_app_id: args.appId, config_id: configId, updated_at: agora })
      .eq('account_id', args.accountId)
      .eq('login', args.login)
      .select('account_id');
    if (error) {
      throw new Error(`Falha ao atualizar o app do Instagram: ${error.message}`);
    }
    return data && data.length > 0 ? 'gravado' : 'sem_app';
  }
  const { error } = await admin.from('cb_instagram_config').upsert(
    {
      account_id: args.accountId,
      login: args.login,
      ig_app_id: args.appId,
      ig_app_secret: encrypt(args.appSecret),
      config_id: configId,
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
