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
  /**
   * `null` = o chamador não escolheu (o login do Instagram): na criação vira
   * `@username`, e no RECADASTRO o rótulo que o operador deu FICA. O token
   * colado manda o que foi digitado no formulário.
   */
  label: string | null;
  accessToken: string;
  igAppSecret: string;
  /** Mesma regra do `label`: `null` preserva o que "Configurar" gravou. */
  humanAgent: boolean | null;
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
      label: dados.label ?? `@${dados.perfil.username}`,
      // NUNCA o padrão da conta: o padrão é o número de WhatsApp que responde
      // conversa sem canal e alimenta o espelho `whatsapp_config`.
      is_default: false,
      display_phone: null,
      verify_token: encrypt(verifyToken),
      ig_user_id: dados.perfil.igUserId,
      ig_human_agent: dados.humanAgent ?? false,
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
  const { data: existente, error: erroDaReleitura } = await db
    .from('cb_channels')
    .select('id')
    .eq('account_id', dados.accountId)
    .eq('kind', 'instagram')
    .eq('ig_user_id', dados.perfil.igUserId)
    .maybeSingle();
  if (erroDaReleitura) {
    // Erro de banco NÃO é "não encontrado": sem esta guarda, um blip do
    // PostgREST aqui afirmaria "conectada em outra conta" sobre a própria.
    console.error(
      '[instagram/canal] releitura depois do 23505 falhou:',
      erroDaReleitura.message
    );
    return {
      ok: false,
      codigo: 'db_error',
      mensagem: 'Não foi possível conferir a conexão do Instagram.',
    };
  }

  if (!existente) {
    return {
      ok: false,
      codigo: 'outra_conta',
      mensagem: `A conta @${dados.perfil.username} já está conectada em outra conta deste CRM.`,
    };
  }

  // Reconectar renova as CREDENCIAIS. Rótulo e Human Agent só mudam quando
  // o chamador os mandou: o login do Instagram é o caminho natural de
  // renovar o token de 60 dias, e renomear a conexão (bolha, filtros,
  // visões salvas) ou desligar a janela de 7 dias a cada renovação seria
  // apagar em silêncio o que o operador configurou.
  const { data: atualizado, error: erroDoUpdate } = await db
    .from('cb_channels')
    .update({
      ...credenciais,
      ...(dados.label !== null ? { label: dados.label } : {}),
      ...(dados.humanAgent !== null ? { ig_human_agent: dados.humanAgent } : {}),
    })
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
