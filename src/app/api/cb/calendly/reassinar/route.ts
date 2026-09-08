import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { origemPublica, reassinarWebhook } from "@/lib/calendly/conexao";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/calendly/reassinar  (admin+)
 *
 * Recria a assinatura do webhook com o token guardado — para quando o
 * Calendly a desativou (24h de falhas), quando a URL pública mudou, ou
 * quando a conexão nasceu com o webhook recusado. Chave de assinatura NOVA
 * a cada reassinatura.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await reassinarWebhook(supabaseAdmin(), ctx.accountId, origemPublica(new URL(request.url).origin));
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "nao_conectado" ? 404 : 400;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    return NextResponse.json({ ok: true, escopo: r.escopo });
  } catch (err) {
    return toErrorResponse(err);
  }
}
