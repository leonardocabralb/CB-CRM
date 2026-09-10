// ============================================================
// Gravar a conexão do Instagram em `cb_channels` — o trecho comum aos DOIS
// caminhos de conexão: o token colado (`POST /api/cb/channels`) e o login
// do Instagram (`/api/cb/instagram/oauth/callback`). Quem chama já conferiu
// o token no `/me`; aqui é só a escrita, com a regra do índice único GLOBAL
// de `ig_user_id` (989): na MESMA conta, reconectar é recuperação (token e
// segredo novos, verify token preservado — o painel da Meta já o conhece);
// em OUTRA conta é recusa.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { CB_CHANNEL_SAFE_COLUMNS, type CbChannel } from '@/lib/cb-channels/repo';
import { encrypt } from '@/lib/whatsapp/encryption';

import type { PerfilDaConta } from './graph';
import { novoVerifyToken } from './verify-token';

export interface DadosDoCanalDoInstagram {
  accountId: string;
  userId: string;
  label: string;
  accessToken: string;
  igAppSecret: string;
  humanAgent: boolean;
  perfil: PerfilDaConta;
  /** ISO do vencimento do token — medido (`expires_in`) ou presumido. */
  tokenExpiraEm: string;
}

export type ResultadoDoCanal =
  | {
      ok: true;
      canal: CbChannel;
      reconectado: boolean;
      /**
       * Em claro SÓ na criação. No recadastro vem `null`: o painel da Meta já
       * o conhece, e o GET da conexão o devolve a quem precisar.
       */
      verifyToken: string | null;
    }
  | { ok: false; codigo: 'outra_conta' | 'db_error'; mensagem: string };

export async function gravarCanalDoInstagram(
  db: SupabaseClient,
  dados: DadosDoCanalDoInstagram
): Promise<ResultadoDoCanal> {
  const nowIso = new Date().toISOString();
  const verifyToken = novoVerifyToken();
  const credenciais = {
    access_token: encrypt(dados.accessToken),
    ig_app_secret: encrypt(dados.igAppSecret),
    ig_username: dados.perfil.username,
    ig_token_expires_at: dados.tokenExpiraEm,
    ig_token_refreshed_at: nowIso,
    ig_human_agent: dados.humanAgent,
    status: 'connected',
    connected_at: nowIso,
    last_error: null,
  };

  const { data: canal, error } = await db
    .from('cb_channels')
    .insert({
      account_id: dados.accountId,
      created_by: dados.userId,
      kind: 'instagram',
      label: dados.label,
      // NUNCA o padrão da conta: o padrão é o número de WhatsApp que responde
      // conversa sem canal e alimenta o espelho `whatsapp_config`.
      is_default: false,
      display_phone: null,
      verify_token: encrypt(verifyToken),
      ig_user_id: dados.perfil.igUserId,
      ...credenciais,
    })
    .select(CB_CHANNEL_SAFE_COLUMNS)
    .single();

  if (!error) {
    return {
      ok: true,
      canal: canal as unknown as CbChannel,
      reconectado: false,
      verifyToken,
    };
  }

  if (error.code !== '23505') {
    console.error(
      '[instagram/canal] erro ao inserir canal Instagram:',
      error.code,
      error.message
    );
    return {
      ok: false,
      codigo: 'db_error',
      mensagem: 'Não foi possível salvar a conexão do Instagram.',
    };
  }

  // O índice único GLOBAL de ig_user_id barra a mesma conta do Instagram
  // duas vezes. NESTA conta, o re-cadastro é recuperação: atualiza. Em OUTRA
  // conta (linha invisível pela RLS) é recusa.
  const { data: existente } = await db
    .from('cb_channels')
    .select('id')
    .eq('account_id', dados.accountId)
    .eq('kind', 'instagram')
    .eq('ig_user_id', dados.perfil.igUserId)
    .maybeSingle();

  if (!existente) {
    return {
      ok: false,
      codigo: 'outra_conta',
      mensagem: `A conta @${dados.perfil.username} já está conectada em outra conta deste CRM.`,
    };
  }

  const { data: atualizado, error: erroDoUpdate } = await db
    .from('cb_channels')
    .update({ label: dados.label, ...credenciais })
    .eq('id', existente.id)
    .eq('account_id', dados.accountId)
    .select(CB_CHANNEL_SAFE_COLUMNS)
    .single();
  if (erroDoUpdate || !atualizado) {
    console.error(
      '[instagram/canal] recadastro do Instagram falhou:',
      erroDoUpdate?.message
    );
    return {
      ok: false,
      codigo: 'db_error',
      mensagem: 'Não foi possível atualizar a conexão do Instagram.',
    };
  }
  return {
    ok: true,
    canal: atualizado as unknown as CbChannel,
    reconectado: true,
    verifyToken: null,
  };
}
