import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { conectarTldv, desconectarTldv } from "@/lib/tldv/conexao";
import { sincronizarTldv } from "@/lib/tldv/sincronizar";

/**
 * PUT /api/cb/tldv/config  (admin+) — conecta (ou troca a chave).
 *
 * Corpo: `{ api_key }`. A chave é TESTADA na hora (uma listagem) e gravada
 * cifrada; a primeira sincronização (30 dias) corre em `after()`. Falha
 * volta como CÓDIGO, nunca a mensagem crua do tl;dv.
 *
 * DELETE — desconecta: apaga a config. As reuniões importadas FICAM, são
 * histórico do cliente.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:tldv:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { api_key?: unknown } | null;
    const chave = typeof corpo?.api_key === "string" ? corpo.api_key.trim() : "";
    if (chave.length < 10 || chave.length > 500) return NextResponse.json({ error: "chave_invalida" }, { status: 400 });

    const r = await conectarTldv(supabaseAdmin(), ctx.accountId, ctx.userId, chave);
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : 400;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    // O `after()` sobrevive à resposta; o client RLS do pedido, não — por
    // isso o admin é criado dentro.
    after(async () => {
      await sincronizarTldv(supabaseAdmin(), ctx.accountId, { primeira: true });
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:tldv:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarTldv(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
