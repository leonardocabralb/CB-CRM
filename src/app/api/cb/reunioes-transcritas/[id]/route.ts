import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { hasMinRole } from "@/lib/auth/roles";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/cb/reunioes-transcritas/[id]  (agent+) — vincular ou desvincular
 * o cliente. Corpo: `{ contact_id: uuid | null }`. Vincular grava vínculo
 * `manual`; desvincular grava `desvinculada`, e é isso que impede a
 * sincronização de religar pelo e-mail no ciclo seguinte (987).
 *
 * DELETE — só a transcrição MANUAL, pelo autor ou por admin. A importada do
 * tl;dv não se apaga (a varredura a traria de volta em 7 dias, sem cliente);
 * dela se tira o cliente.
 *
 * ⚠️ Toda escrita confere o ROWCOUNT: em service role o `.eq('account_id')`
 * é a única cerca, e um update que não achou a linha volta sem erro.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cb:reunioes-transcritas:${ctx.userId}`, RATE_LIMITS.reuniaoTranscrita);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const corpo = (await request.json().catch(() => null)) as { contact_id?: unknown } | null;
    if (corpo === null || !("contact_id" in corpo)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const contactId = corpo.contact_id === null ? null : typeof corpo.contact_id === "string" && UUID.test(corpo.contact_id) ? corpo.contact_id : undefined;
    if (contactId === undefined) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const admin = supabaseAdmin();
    if (contactId) {
      const { data: contato } = await admin.from("contacts").select("id").eq("id", contactId).eq("account_id", ctx.accountId).maybeSingle();
      if (!contato) return NextResponse.json({ error: "contato_nao_encontrado" }, { status: 400 });
    }
    const agora = new Date().toISOString();
    const { data, error } = await admin
      .from("cb_reunioes_transcritas")
      .update({
        contact_id: contactId,
        vinculo_origem: contactId ? "manual" : "desvinculada",
        vinculado_por: ctx.userId,
        vinculado_em: agora,
        updated_at: agora,
      })
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id, contact_id, vinculo_origem");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, reuniao: data[0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cb:reunioes-transcritas:${ctx.userId}`, RATE_LIMITS.reuniaoTranscrita);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    if (!UUID.test(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const admin = supabaseAdmin();
    const { data: linha, error: erroLeitura } = await admin
      .from("cb_reunioes_transcritas")
      .select("id, origem, created_by")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!linha) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (linha.origem !== "manual") return NextResponse.json({ error: "so_manual" }, { status: 409 });
    if (linha.created_by !== ctx.userId && !hasMinRole(ctx.role, "admin")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const { data, error } = await admin.from("cb_reunioes_transcritas").delete().eq("id", id).eq("account_id", ctx.accountId).select("id");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
