// ============================================================
// API key store — the *auth-path* data access for public API keys.
//
// Only the read side lives here, and deliberately so: it runs with
// the service-role client because a public-API caller has no Supabase
// session, so RLS (which keys off `auth.uid()`) can't scope the
// lookup. The management side (list / create / revoke) runs in the
// dashboard under a real cookie session and goes through the RLS
// client *inline* in the route handlers — same pattern as
// `/api/account/invitations`. Keeping the RLS-bypassing surface tiny
// and read-only here makes it easy to audit.
// ============================================================

import { supabaseAdmin } from '@/lib/flows/admin-client';

/** Shape of an `api_keys` row as the auth path consumes it. */
export interface ApiKeyRow {
  id: string;
  account_id: string;
  created_by: string | null;
  name: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
  /**
   * NOSSO (1121): o funcionário dono da chave. Nulo = chave da CONTA (n8n,
   * Make), como toda chave anterior. Com valor, `requireApiKey` confere a
   * cada chamada que ele continua na conta e não está suspenso.
   */
  membro_user_id: string | null;
  /** NOSSO (1121): funis que a chave enxerga. Nulo = todos. */
  funis: string[] | null;
}

/**
 * Look up an *active* key by its SHA-256 hash. Returns null if no
 * row matches, or if the matching row is revoked or expired — so
 * callers never have to re-check liveness. Uses the service-role
 * client (RLS-bypassing); the hash is the only credential, so this
 * is the moment that establishes the caller's account.
 *
 * ⚠️ NOSSO: a leitura que FALHA lança, em vez de devolver null. Null é
 * "chave inválida" — o integrador recebia 401 num soluço do banco, e quem
 * recebe 401 troca a chave ou desliga a integração. `requireApiKey`
 * converte o lançamento em 500.
 */
export async function findActiveKeyByHash(
  hash: string
): Promise<ApiKeyRow | null> {
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select(
      'id, account_id, created_by, name, scopes, expires_at, revoked_at, membro_user_id, funis'
    )
    .eq('key_hash', hash)
    .maybeSingle();

  if (error) {
    console.error('[api-keys/store] lookup error:', error.message);
    throw new Error('API key lookup failed');
  }
  if (!data) return null;

  // Liveness checks in JS rather than SQL so the failure modes are
  // explicit and the index stays a simple equality lookup.
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
    return null;
  }

  return data as ApiKeyRow;
}

/**
 * NOSSO (1121): o funcionário dono da chave ainda é membro ATIVO da conta
 * da chave? Lê `profiles` com service role, então a RLS (e com ela o corte
 * de `is_account_member` para o suspenso, 1067) NÃO se aplica: a suspensão
 * é conferida aqui, por escrito. Remover da equipe (`remove_account_member`)
 * move o perfil para uma conta própria, e a conferência pela `account_id`
 * da chave cobre esse caso também.
 *
 * ⚠️ A leitura que FALHA lança (como `findActiveKeyByHash`): "não sei" nunca
 * vira "não é membro" (401, chave recusada) nem "é membro" (chave aberta).
 */
export async function funcionarioAtivoNaConta(
  userId: string,
  accountId: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from('profiles')
    .select('id')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .is('suspenso_em', null)
    .limit(1);

  if (error) {
    console.error('[api-keys/store] member lookup error:', error.message);
    throw new Error('API key member lookup failed');
  }
  return (data ?? []).length > 0;
}

/**
 * Fetch the account name for a resolved key, so `/api/v1/me` and any
 * future endpoint can echo it without a second round trip in the
 * route. Service-role; the key already proved account membership.
 */
export async function getAccountName(
  accountId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from('accounts')
    .select('name')
    .eq('id', accountId)
    .maybeSingle();
  if (error || !data) return null;
  return (data.name as string) ?? null;
}

/**
 * Best-effort `last_used_at` bump. Fire-and-forget from the auth
 * path — a failed update just means the "last used" column lags;
 * it must never fail the request the caller is actually making.
 */
export function touchLastUsed(id: string): void {
  void supabaseAdmin()
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
    .then(({ error }) => {
      if (error) {
        console.warn(
          '[api-keys/store] last_used_at bump failed:',
          error.message
        );
      }
    });
}
