import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { COLUNAS_DO_EVENTO, EVENTOS_POR_PAGINA } from "@/lib/calendly/log";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/calendly/eventos?pagina=N  (admin+)
 *
 * Uma página do log de recebimentos, dos mais recentes para os mais
 * antigos. `total` vem do `count: 'exact'` (viaja no cabeçalho, de
 * graça) — é o que permite "página 2 de 7" sem carregar o resto.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const pedido = Number(new URL(request.url).searchParams.get("pagina") ?? "1");
    const pagina = Number.isInteger(pedido) && pedido >= 1 ? pedido : 1;
    const de = (pagina - 1) * EVENTOS_POR_PAGINA;

    const { data, error, count } = await supabaseAdmin()
      .from("cb_calendly_eventos")
      .select(COLUNAS_DO_EVENTO, { count: "exact" })
      .eq("account_id", ctx.accountId)
      .order("recebido_em", { ascending: false })
      .range(de, de + EVENTOS_POR_PAGINA - 1);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });

    return NextResponse.json({ eventos: data ?? [], total: count ?? 0, pagina, porPagina: EVENTOS_POR_PAGINA });
  } catch (err) {
    return toErrorResponse(err);
  }
}
