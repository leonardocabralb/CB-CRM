import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { importarReuniaoDoTldv } from "@/lib/tldv/sincronizar";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/cb/reunioes-transcritas/[id]/reprocessar  (agent+) — "Buscar de
 * novo": zera as tentativas de uma reunião do tl;dv (`sem_transcricao`,
 * `falhou` ou ainda `pendente`) e busca a transcrição AGORA. Só importada;
 * a manual não tem de onde buscar.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cb:reunioes-transcritas:${ctx.userId}`, RATE_LIMITS.reuniaoTranscrita);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const admin = supabaseAdmin();
    const { data: linha, error: erroLeitura } = await admin
      .from("cb_reunioes_transcritas")
      .select("id, origem, tldv_meeting_id, status")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!linha) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (linha.origem !== "tldv" || !linha.tldv_meeting_id) return NextResponse.json({ error: "so_tldv" }, { status: 409 });
    if (linha.status === "pronta") return NextResponse.json({ ok: true, status: "pronta" });

    const { data: zerada, error: erroZerar } = await admin
      .from("cb_reunioes_transcritas")
      .update({ tentativas: 0, status: "pendente", erro: null, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id");
    if (erroZerar || !zerada || zerada.length === 0) return NextResponse.json({ error: "db_error" }, { status: 500 });

    const r = await importarReuniaoDoTldv(admin, ctx.accountId, linha.tldv_meeting_id as string);
    if (!r.ok) {
      const status = r.codigo === "nao_conectado" || r.codigo === "nao_encontrado" ? 404 : r.codigo === "db_error" ? 500 : 502;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    return NextResponse.json({ ok: true, status: r.status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
