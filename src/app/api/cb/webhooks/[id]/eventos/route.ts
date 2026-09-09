// ============================================================
// GET /api/cb/webhooks/{id}/eventos?pagina=N — o log de um webhook. Admin+.
//
// É por esta lista que "configurei e não aconteceu nada" tem resposta: ela
// diz se o acionamento CHEGOU e o que o CRM fez com ele.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  COLUNAS_DO_EVENTO,
  EVENTOS_POR_PAGINA,
} from "@/lib/webhooks-de-entrada/log";

/** Os resultados que o resumo do cabeçalho conta. */
const RESUMIDOS = [
  "disparado",
  "sem_automacao",
  "sem_telefone",
  "falhou",
] as const;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { id } = await params;
    const pedido = Number(
      new URL(request.url).searchParams.get("pagina") ?? "1"
    );
    const pagina = Number.isInteger(pedido) && pedido >= 1 ? pedido : 1;
    const de = (pagina - 1) * EVENTOS_POR_PAGINA;

    const admin = supabaseAdmin();
    const { data, error, count } = await admin
      .from("cb_webhook_eventos")
      .select(COLUNAS_DO_EVENTO, { count: "exact" })
      .eq("account_id", ctx.accountId)
      .eq("webhook_id", id)
      .order("recebido_em", { ascending: false })
      .range(de, de + EVENTOS_POR_PAGINA - 1);

    if (error) {
      console.error("[cb/webhooks/eventos] listar:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    // O resumo só sai na primeira página: ele não muda ao paginar, e são
    // quatro consultas `head` a mais que não precisam se repetir.
    let contagem: Record<string, number> | null = null;
    if (pagina === 1) {
      const pares = await Promise.all(
        RESUMIDOS.map(async (r) => {
          const { count: n } = await admin
            .from("cb_webhook_eventos")
            .select("id", { count: "exact", head: true })
            .eq("account_id", ctx.accountId)
            .eq("webhook_id", id)
            .eq("resultado", r);
          return [r, n ?? 0] as const;
        })
      );
      contagem = Object.fromEntries(pares);
    }

    return NextResponse.json({
      eventos: data ?? [],
      total: count ?? 0,
      pagina,
      porPagina: EVENTOS_POR_PAGINA,
      contagem,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
