// ============================================================
// /api/cb/webhooks-de-saida — os `webhook_endpoints` da 028. Admin+.
//
// ⚠️ Por que rotas NOVAS em vez de reusar `/api/v1/webhooks`: aquelas
// autenticam por CHAVE DE API, e a tela teria de carregar uma chave para
// falar com o próprio CRM — exatamente o que esta seção existe para evitar.
// A lógica compartilhada (validação de URL, vocabulário de eventos, geração
// e cifra do segredo) vem dos MESMOS módulos, então as duas portas não
// divergem.
//
// Estes webhooks existem desde o upstream e nunca tiveram tela: até aqui a
// única forma de registrar um era `curl` com uma chave de escopo
// `webhooks:manage`. Em produção havia ZERO endpoints registrados.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  generateWebhookSecret,
  normalizeWebhookUrl,
  serializeWebhookEndpoint,
  WEBHOOK_PUBLIC_COLUMNS,
} from "@/lib/webhooks/endpoints";
import { normalizeEvents } from "@/lib/webhooks/events";
import { encrypt } from "@/lib/whatsapp/encryption";

export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks-saida:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { data, error } = await supabaseAdmin()
      .from("webhook_endpoints")
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[cb/webhooks-de-saida] listar:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return NextResponse.json({
      endpoints: (data ?? []).map((r) =>
        serializeWebhookEndpoint(r as Record<string, unknown>)
      ),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks-saida:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const corpo = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!corpo) {
      return NextResponse.json({ error: "corpo_invalido" }, { status: 400 });
    }

    const url = normalizeWebhookUrl(corpo.url);
    if (!url) {
      return NextResponse.json({ error: "url_invalida" }, { status: 400 });
    }
    const eventos = normalizeEvents(corpo.events);
    if (!eventos) {
      return NextResponse.json({ error: "eventos_invalidos" }, { status: 400 });
    }

    const segredo = generateWebhookSecret();
    const { data, error } = await supabaseAdmin()
      .from("webhook_endpoints")
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        url,
        secret: encrypt(segredo),
        events: eventos,
      })
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .single();

    if (error || !data) {
      console.error("[cb/webhooks-de-saida] criar:", error);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    return NextResponse.json(
      {
        endpoint: serializeWebhookEndpoint(data as Record<string, unknown>),
        // Única vez que ele existe em claro fora do banco.
        segredo,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
