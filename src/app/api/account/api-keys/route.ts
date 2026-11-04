// ============================================================
// /api/account/api-keys
//
//   GET  — list this account's API keys (safe columns only).
//   POST — mint a new key.
//
// These are the *dashboard* endpoints for managing keys, so they
// authenticate the normal way (cookie session) and go through the
// RLS client. Listing is open to any member (viewer+) — the roster
// is not secret; the secret (the key itself) is never in it. Minting
// is admin+ (a key hands out capabilities), enforced by both
// `requireRole('admin')` here and the `api_keys_insert` RLS policy.
//
// IMPORTANT: the plaintext key is returned exactly ONCE, in the POST
// response. We persist only its SHA-256 hash, so neither GET nor any
// future endpoint can resurface it — same one-time-reveal contract
// as invite links. If the admin loses it, they revoke and re-issue.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import {
  COLUNAS_DA_CHAVE,
  escritaNaChaveRecortada,
  funisSaoDaConta,
  lerFunis,
  lerMembro,
  lerValidade,
  membroAtivoDaConta,
} from '@/lib/api-keys/configuracao';
import { generateApiKey } from '@/lib/api-keys/keys';
import { normalizeScopes } from '@/lib/api-keys/scopes';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

const MAX_NAME_LEN = 80;

// Columns safe to expose. `key_hash` is deliberately excluded — it
// never leaves the server. NOSSO (1120): a lista mora em `configuracao.ts`
// (a rota de edição devolve a mesma), com o funcionário dono e os funis.
const SAFE_COLUMNS = COLUNAS_DA_CHAVE;

export async function GET() {
  try {
    // Any member can view the roster (RLS allows it); we just need a
    // resolved account context.
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .select(SAFE_COLUMNS)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[GET /api/account/api-keys] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load API keys' },
        { status: 500 }
      );
    }

    return NextResponse.json({ keys: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:apiKeyCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
      membroUserId?: unknown;
      funis?: unknown;
    } | null;

    const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!rawName) {
      return NextResponse.json(
        { error: "'name' is required" },
        { status: 400 }
      );
    }
    if (rawName.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME_LEN} characters or fewer` },
        { status: 400 }
      );
    }

    // Scopes default to none if omitted — that yields a key that can
    // only call the scope-free endpoints (e.g. GET /api/v1/me).
    const scopes = normalizeScopes(body?.scopes ?? []);
    if (scopes === null) {
      return NextResponse.json(
        { error: "'scopes' must be an array of known scope strings" },
        { status: 400 }
      );
    }

    // NOSSO (1120): validade, funcionário e funis pela régua de
    // `configuracao.ts`. Ausente = como antes (sem validade, chave da conta,
    // todos os funis).
    const validade = lerValidade(body?.expiresInDays, Date.now());
    const membro = lerMembro(body?.membroUserId);
    const funis = lerFunis(body?.funis);
    for (const lido of [validade, membro, funis]) {
      if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
    }
    const expiresAt = (validade.ok && validade.valor) || null;
    const membroUserId = (membro.ok && membro.valor) || null;
    const funisDaChave = (funis.ok && funis.valor) || null;

    // A chave recortada por funil é SÓ DE LEITURA (decisão do operador).
    const escrita = escritaNaChaveRecortada(funisDaChave, scopes);
    if (escrita) {
      return NextResponse.json(
        { error: `A key limited to pipelines is read-only: remove '${escrita}'` },
        { status: 400 }
      );
    }

    try {
      if (funisDaChave && !(await funisSaoDaConta(ctx.supabase, ctx.accountId, funisDaChave))) {
        return NextResponse.json(
          { error: "'funis' must be pipelines of this account" },
          { status: 400 }
        );
      }
      if (membroUserId && !(await membroAtivoDaConta(ctx.supabase, ctx.accountId, membroUserId))) {
        return NextResponse.json(
          { error: "'membroUserId' must be an active member of this account" },
          { status: 400 }
        );
      }
    } catch (err) {
      // Leitura que falhou não é "inválido" (CLAUDE.md, 8b).
      console.error('[POST /api/account/api-keys] lookup error:', err);
      return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 });
    }

    const { plaintext, hash, prefix } = generateApiKey();

    const { data, error } = await ctx.supabase
      .from('api_keys')
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        name: rawName,
        key_prefix: prefix,
        key_hash: hash,
        scopes,
        expires_at: expiresAt,
        membro_user_id: membroUserId,
        funis: funisDaChave,
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error || !data) {
      console.error('[POST /api/account/api-keys] insert error:', error);
      return NextResponse.json(
        { error: 'Failed to create API key' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        key: data,
        // Plaintext — shown to the admin exactly once.
        plaintext,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
