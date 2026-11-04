// ============================================================
// DELETE /api/account/api-keys/[id] — revoke a key.
//
// Soft revoke: sets `revoked_at` rather than deleting the row, so
// the key's name/prefix stay visible in the roster as an audit
// trail ("this key existed and was turned off") and so the auth
// path's liveness check (`findActiveKeyByHash` filters revoked
// rows) starts rejecting it immediately. Admin+, enforced here and
// by the `api_keys_update` RLS policy.
//
// Revocation is effective on the next request: once `revoked_at` is
// set, `findActiveKeyByHash` returns null and the key 401s.
// ============================================================

import { NextResponse } from 'next/server';

import {
  COLUNAS_DA_CHAVE,
  escritaProibida,
  funisSaoDaConta,
  lerFunis,
  lerMembro,
  lerValidade,
  membroAtivoDaConta,
} from '@/lib/api-keys/configuracao';
import { normalizeScopes, type ApiScope } from '@/lib/api-keys/scopes';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { ehUuid } from '@/lib/tasks/validar';

const MAX_NAME_LEN = 80;

// ============================================================
// NOSSO (1121): PATCH /api/account/api-keys/[id] — o admin EDITA a chave
// (decisão do operador, 04/11/2026): nome, permissões, validade,
// funcionário e funis, sem gerar outra. O segredo não muda: quem já usa a
// chave continua usando. Só os campos ENVIADOS mudam; a regra "recortada
// por funil é só leitura" vale para o resultado (o que já está gravado mais
// o que chegou). Chave revogada não se edita (404, como no revogar).
//
// ⚠️ A edição vale na PRÓXIMA chamada (o caminho da chave lê a linha a cada
// pedido): tirar um funil corta o acesso na hora.
// ============================================================
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:apiKeyEdit:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!ehUuid(id)) {
      return NextResponse.json({ error: "'id' must be a UUID" }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
      membroUserId?: unknown;
      funis?: unknown;
    } | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const mudancas: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const nome = typeof body.name === 'string' ? body.name.trim() : '';
      if (!nome) {
        return NextResponse.json({ error: "'name' is required" }, { status: 400 });
      }
      if (nome.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 }
        );
      }
      mudancas.name = nome;
    }

    let scopes: ApiScope[] | undefined;
    if (body.scopes !== undefined) {
      const lidos = normalizeScopes(body.scopes);
      if (lidos === null) {
        return NextResponse.json(
          { error: "'scopes' must be an array of known scope strings" },
          { status: 400 }
        );
      }
      scopes = lidos;
      mudancas.scopes = lidos;
    }

    const validade = lerValidade(body.expiresInDays, Date.now());
    const membro = lerMembro(body.membroUserId);
    const funis = lerFunis(body.funis);
    for (const lido of [validade, membro, funis]) {
      if (!lido.ok) return NextResponse.json({ error: lido.erro }, { status: 400 });
    }
    if (validade.ok && validade.valor !== undefined) mudancas.expires_at = validade.valor;
    if (membro.ok && membro.valor !== undefined) mudancas.membro_user_id = membro.valor;
    if (funis.ok && funis.valor !== undefined) mudancas.funis = funis.valor;

    if (Object.keys(mudancas).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // O que JÁ está gravado, para conferir o resultado da edição.
    const { data: atual, error: erroAtual } = await ctx.supabase
      .from('api_keys')
      .select('scopes, funis, membro_user_id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .maybeSingle();
    if (erroAtual) {
      console.error('[PATCH /api/account/api-keys/[id]] read error:', erroAtual);
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }
    if (!atual) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    const funisDepois =
      'funis' in mudancas ? (mudancas.funis as string[] | null) : ((atual.funis as string[] | null) ?? null);
    const membroDepois =
      'membro_user_id' in mudancas
        ? (mudancas.membro_user_id as string | null)
        : ((atual.membro_user_id as string | null) ?? null);
    const escoposDepois = scopes ?? ((atual.scopes as ApiScope[] | null) ?? []);
    const escrita = escritaProibida(
      { funis: funisDepois, membroUserId: membroDepois },
      escoposDepois
    );
    if (escrita) {
      return NextResponse.json(
        { error: `A team member's or pipeline-limited key is read-only: remove '${escrita}'` },
        { status: 400 }
      );
    }

    try {
      const novosFunis = mudancas.funis as string[] | null | undefined;
      if (novosFunis && !(await funisSaoDaConta(ctx.supabase, ctx.accountId, novosFunis))) {
        return NextResponse.json(
          { error: "'funis' must be pipelines of this account" },
          { status: 400 }
        );
      }
      const novoMembro = mudancas.membro_user_id as string | null | undefined;
      if (novoMembro && !(await membroAtivoDaConta(ctx.supabase, ctx.accountId, novoMembro))) {
        return NextResponse.json(
          { error: "'membroUserId' must be an active member of this account" },
          { status: 400 }
        );
      }
    } catch (err) {
      console.error('[PATCH /api/account/api-keys/[id]] lookup error:', err);
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }

    // Cercado pela conta e por "não revogada"; zero linhas = sumiu ou foi
    // revogada no meio (RLS que barra também dá zero, sem erro: o 404 diz a
    // verdade para os dois casos — a tela recarrega a lista).
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update(mudancas)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select(COLUNAS_DA_CHAVE)
      .maybeSingle();
    if (error) {
      console.error('[PATCH /api/account/api-keys/[id]] update error:', error);
      return NextResponse.json({ error: 'Failed to update API key' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }
    return NextResponse.json({ key: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(
      `admin:apiKeyRevoke:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // Scope the update by account_id as well as id so an admin can
    // never revoke another account's key by guessing a UUID. (RLS
    // already enforces this; the explicit filter is belt-and-braces
    // and makes the "0 rows updated → 404" path precise.)
    const { data, error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[DELETE /api/account/api-keys/[id]] error:', error);
      return NextResponse.json(
        { error: 'Failed to revoke API key' },
        { status: 500 }
      );
    }
    if (!data) {
      // Either no such key in this account, or it was already revoked.
      return NextResponse.json(
        { error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
