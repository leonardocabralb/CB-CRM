// ============================================================
// Public API authentication — resolve a request's API key into an
// account context.
//
// This is the machine-to-machine counterpart of `getCurrentAccount`
// (cookie session → account). Where the dashboard authenticates a
// human via Supabase cookies, the public API authenticates a caller
// via `Authorization: Bearer wacrm_live_…`.
//
// Calling convention — every `/api/v1` route does:
//
//   try {
//     const ctx = await requireApiKey(request, "messages:send");
//     // ctx.supabase   — service-role client (no user session exists)
//     // ctx.accountId  — the key's account; scope every query by it
//     // ctx.scopes     — granted scopes
//     // ctx.keyId      — for logging / the rate-limit bucket
//   } catch (err) {
//     return toApiErrorResponse(err);   // maps ApiError → envelope
//   }
//
// Why a service-role client: an API caller has no Supabase session,
// so there's no `auth.uid()` for RLS to match. The key lookup itself
// establishes the account; from there every downstream query MUST be
// explicitly filtered by `ctx.accountId` (the same discipline the
// dashboard's send route already follows). The key never escalates
// past its own account because the account is fixed at lookup time.
//
// ⚠️ O cliente é o PRÓPRIO da API (`clienteDaApi`), nunca o
// `supabaseAdmin()` compartilhado de `flows/admin-client.ts`: ele manda o
// cabeçalho `x-cb-origem: api`, que o gatilho da fila do funil (1040) lê
// para dizer, no aviso `deal.*`, que o card foi movido PELA API. Ver
// `src/lib/api/v1/cliente-da-api.ts`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { clienteDaApi } from '@/lib/api/v1/cliente-da-api';
import {
  findActiveKeyByHash,
  funcionarioAtivoNaConta,
  touchLastUsed,
} from '@/lib/api-keys/store';
import { hashApiKey, looksLikeApiKey } from '@/lib/api-keys/keys';
import { ehEscopoDeLeitura, hasScope, type ApiScope } from '@/lib/api-keys/scopes';
import { ApiError, forbidden, rateLimited, unauthorized } from '@/lib/api/v1/respond';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

export interface ApiKeyContext {
  /** Discriminant — lets shared logic tell key auth from cookie auth. */
  authType: 'api_key';
  /**
   * Service-role Supabase client. RLS-bypassing; scope by accountId.
   * É o da API (`clienteDaApi`), que marca a origem dos movimentos de card.
   */
  supabase: SupabaseClient;
  /** The account this key belongs to. */
  accountId: string;
  /** The key row id — for audit logging and the rate-limit bucket. */
  keyId: string;
  /** Scopes granted to this key. */
  scopes: string[];
  /** Who minted the key (null if that user was later removed). */
  createdBy: string | null;
  /**
   * NOSSO (1121): o funcionário dono da chave (nulo = chave da conta). Já
   * conferido: chegar aqui quer dizer que ele está na conta e não suspenso.
   */
  membroUserId: string | null;
  /**
   * NOSSO (1121): os funis que a chave enxerga; nulo = todos. Só chega a uma
   * rota que declarou `aceitaRecorte` — e ela recorta TODA leitura por eles
   * (`src/lib/api/v1/recorte-por-funil.ts`).
   */
  funis: string[] | null;
}

/** NOSSO (1121): o que a rota declara a `requireApiKey`. */
export interface OpcoesDaChave {
  /**
   * A rota sabe recortar por funil. Sem esta declaração, chave com `funis`
   * é recusada com 403 `restricted_key` — DEFAULT-DENY: rota nova não vaza a
   * conta inteira por esquecimento. Pino:
   * `src/app/api/v1/recorte-por-funil.chamadores.test.ts`.
   */
  aceitaRecorte?: boolean;
}

/**
 * Extract the bearer token from the `Authorization` header.
 * Tolerates the `Bearer ` prefix being absent (some clients send the
 * bare key) but requires the value to look like one of our keys.
 */
function extractKey(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const value = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : header.trim();
  return value.length > 0 ? value : null;
}

/**
 * Authenticate a public-API request and (optionally) enforce a
 * single scope. Throws an `ApiError` (mapped to the envelope by
 * `toApiErrorResponse`) on any failure:
 *
 *   401 unauthorized — no key, malformed, unknown, revoked, expired
 *   403 forbidden    — valid key without the required scope
 *   429 rate_limited — per-key budget exhausted
 *   500 internal     — the key could not be READ (database failure) —
 *                      NOSSO: never a 401, which would read as "revoked"
 *
 * On success, bumps `last_used_at` (fire-and-forget) and returns the
 * account context.
 */
export async function requireApiKey(
  request: Request,
  scope?: ApiScope,
  opcoes: OpcoesDaChave = {}
): Promise<ApiKeyContext> {
  const presented = extractKey(request);
  if (!presented || !looksLikeApiKey(presented)) {
    throw unauthorized();
  }

  let row: Awaited<ReturnType<typeof findActiveKeyByHash>>;
  try {
    row = await findActiveKeyByHash(hashApiKey(presented));
  } catch {
    // ⚠️ NOSSO: a leitura da chave FALHOU (o banco), não a chave. 401 aqui
    // diria ao integrador "revogada" — ele trocaria a chave ou desligaria a
    // integração por um soluço que passa sozinho.
    throw new ApiError('internal', 'Could not verify the API key right now; retry', 500);
  }
  if (!row) {
    // Covers unknown, revoked, and expired keys alike — we don't
    // distinguish them on the wire so a probe can't learn whether a
    // key ever existed.
    throw unauthorized();
  }

  // Rate-limit per key, before the scope check, so an unauthorized-
  // scope caller still can't hammer the endpoint for free.
  const limit = checkRateLimit(`apikey:${row.id}`, RATE_LIMITS.publicApi);
  if (!limit.success) {
    throw rateLimited(limit);
  }

  // NOSSO (1121): chave do FUNCIONÁRIO vale enquanto ele estiver na conta e
  // ativo. A API roda em service role, então o corte da suspensão (1067)
  // não chega aqui sozinho. Suspenso ou fora da conta = 401, igual a uma
  // chave revogada; a leitura que falha = 500 (nunca 401, que o integrador
  // leria como "revogada").
  if (row.membro_user_id) {
    let ativo: boolean;
    try {
      ativo = await funcionarioAtivoNaConta(row.membro_user_id, row.account_id);
    } catch {
      throw new ApiError('internal', 'Could not verify the API key right now; retry', 500);
    }
    if (!ativo) throw unauthorized();
  }

  // NOSSO (1121): DEFAULT-DENY do recorte por funil. Lista VAZIA fecha (o
  // CHECK da 1121 a recusa no banco; se ela aparecer mesmo assim, a chave
  // não vê nada — nunca a conta inteira).
  const funis = Array.isArray(row.funis) ? row.funis : null;
  if (funis && funis.length === 0) {
    throw new ApiError('restricted_key', 'This API key has no pipelines to read', 403);
  }
  if (funis && !opcoes.aceitaRecorte) {
    throw new ApiError(
      'restricted_key',
      'This API key is limited to selected pipelines and cannot call this endpoint',
      403
    );
  }

  // NOSSO (1121): a chave de funcionário e a recortada só LEEM (decisão do
  // operador). As rotas de gestão já recusam escopo de escrita nelas; esta é
  // a 2ª defesa (dois PATCHs em corrida, ou linha escrita por fora).
  if (scope && (row.membro_user_id || funis) && !ehEscopoDeLeitura(scope)) {
    throw forbidden("This API key is read-only (a team member's or pipeline-limited key)");
  }

  if (scope && !hasScope(row.scopes, scope)) {
    throw forbidden(`This API key is missing the '${scope}' scope`);
  }

  touchLastUsed(row.id);

  return {
    authType: 'api_key',
    supabase: clienteDaApi(),
    accountId: row.account_id,
    keyId: row.id,
    scopes: row.scopes,
    createdBy: row.created_by,
    membroUserId: row.membro_user_id ?? null,
    funis,
  };
}
