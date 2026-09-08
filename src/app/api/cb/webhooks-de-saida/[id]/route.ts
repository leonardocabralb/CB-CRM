// ============================================================
// PATCH/DELETE /api/cb/webhooks-de-saida/{id} — Admin+.
//
// PATCH aceita `url`, `events` e `is_active`. ⚠️ Reativar ZERA o contador
// de falhas: quinze falhas seguidas desativam o endpoint sozinho (`deliver.ts`),
// e religar sem zerar o deixaria a uma falha de desligar de novo.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  normalizeWebhookUrl,
  serializeWebhookEndpoint,
  WEBHOOK_PUBLIC_COLUMNS,
} from "@/lib/webhooks/endpoints";
import { normalizeEvents } from "@/lib/webhooks/events";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks-saida:${ctx.userId}`,
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

    const patch: Record<string, unknown> = {};
    if ("url" in corpo) {
      const url = normalizeWebhookUrl(corpo.url);
      if (!url) {
        return NextResponse.json({ error: "url_invalida" }, { status: 400 });
      }
      patch.url = url;
    }
    if ("events" in corpo) {
      const eventos = normalizeEvents(corpo.events);
      if (!eventos) {
        return NextResponse.json(
          { error: "eventos_invalidos" },
          { status: 400 }
        );
      }
      patch.events = eventos;
    }
    if (typeof corpo.is_active === "boolean") {
      patch.is_active = corpo.is_active;
      // Religar zera o contador — senão o endpoint volta a uma falha de
      // desligar de novo, e o operador não entende por quê.
      if (corpo.is_active) patch.failure_count = 0;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nada_a_mudar" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin()
      .from("webhook_endpoints")
      .update(patch)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select(WEBHOOK_PUBLIC_COLUMNS);

    if (error) {
      console.error("[cb/webhooks-de-saida] patch:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if ((data ?? []).length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      endpoint: serializeWebhookEndpoint(data![0] as Record<string, unknown>),
    });
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
      `cb:webhooks-saida:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { id } = await params;
    const { data, error } = await supabaseAdmin()
      .from("webhook_endpoints")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id");

    if (error) {
      console.error("[cb/webhooks-de-saida] delete:", error);
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
