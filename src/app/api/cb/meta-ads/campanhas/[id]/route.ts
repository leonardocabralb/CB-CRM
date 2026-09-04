import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/cb/meta-ads/campanhas/[id]  (admin+)
 *
 * Só `pipeline_id` (uuid ou null), por allowlist — é a atribuição campanha
 * → funil que amarra o gasto ao Desempenho. O funil é conferido contra a
 * conta pelo client RLS do pedido; a escrita é service role (a tabela é
 * fechada para o navegador) e confere ROWCOUNT.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:campanha:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const corpo = (await request.json().catch(() => null)) as { pipeline_id?: unknown } | null;
    if (!corpo || !("pipeline_id" in corpo)) return NextResponse.json({ error: "pipeline_id ausente" }, { status: 400 });
    const pipelineId = corpo.pipeline_id;
    if (pipelineId !== null && (typeof pipelineId !== "string" || !UUID.test(pipelineId))) {
      return NextResponse.json({ error: "pipeline_id inválido" }, { status: 400 });
    }

    if (pipelineId !== null) {
      const { data: funil } = await ctx.supabase.from("pipelines").select("id").eq("id", pipelineId).maybeSingle();
      if (!funil) return NextResponse.json({ error: "Funil não encontrado." }, { status: 404 });
    }

    const { data, error } = await supabaseAdmin()
      .from("cb_meta_ads_campanhas")
      .update({ pipeline_id: pipelineId })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
