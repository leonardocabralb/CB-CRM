// ============================================================
// PATCH/DELETE /api/cb/webhooks/{id} — editar e apagar. Admin+.
//
// ⚠️ Apagar leva o LOG junto (a FK de `cb_webhook_eventos` é CASCADE): sem
// o webhook, a linha não tem nome para escrever nem sobre o que informar.
// A tela avisa quantos acionamentos vão embora antes de confirmar.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { nomeDeVariavel } from "@/lib/webhooks-de-entrada/achatar";
import { COLUNAS_DO_WEBHOOK } from "@/lib/webhooks-de-entrada/repo";

export async function PATCH(
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
    const corpo = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!corpo) {
      return NextResponse.json({ error: "corpo_invalido" }, { status: 400 });
    }

    // Allowlist explícita: coluna fora daqui salva e some no reload — a
    // armadilha que o `CB_CHANNEL_SAFE_COLUMNS` já documenta.
    const patch: Record<string, unknown> = {};
    if (typeof corpo.nome === "string") {
      const nome = corpo.nome.trim();
      if (!nome) {
        return NextResponse.json(
          { error: "nome_obrigatorio" },
          { status: 400 }
        );
      }
      if (nome.length > 60) {
        return NextResponse.json({ error: "nome_longo" }, { status: 400 });
      }
      patch.nome = nome;
    }
    if (typeof corpo.is_active === "boolean") patch.is_active = corpo.is_active;
    for (const campo of ["campo_telefone", "campo_nome", "campo_id"] as const) {
      if (campo in corpo) {
        const v = corpo[campo];
        patch[campo] = typeof v === "string" ? nomeDeVariavel(v) || null : null;
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nada_a_mudar" }, { status: 400 });
    }
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin()
      .from("cb_webhooks")
      .update(patch)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select(COLUNAS_DO_WEBHOOK);

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "nome_repetido" }, { status: 409 });
      }
      console.error("[cb/webhooks] patch:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    // ⚠️ Rowcount, não só o erro: filtro que não casa devolve 0 linhas com
    // `error: null`, e a tela diria "salvo" sobre nada.
    if ((data ?? []).length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ webhook: data![0] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
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
    const { data, error } = await supabaseAdmin()
      .from("cb_webhooks")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id");

    if (error) {
      console.error("[cb/webhooks] delete:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if ((data ?? []).length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
