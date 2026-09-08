import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { conectarCalendly, desconectarCalendly, origemPublica } from "@/lib/calendly/conexao";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * PUT /api/cb/calendly/config  (admin+) — conecta (ou troca o token).
 *
 * Corpo: `{ access_token }`. O token é TESTADO na hora (`GET /users/me`),
 * a assinatura do webhook é criada (organização → usuário) e tudo é
 * gravado cifrado. Falha volta como CÓDIGO, nunca a mensagem crua do
 * Calendly. Token bom + webhook recusado grava a conexão em `erro` com o
 * motivo, e a tela oferece "Reassinar".
 *
 * PATCH — `{ pergunta_telefone }`: o rótulo da pergunta do formulário com o
 * telefone do cliente (vazio = automático).
 *
 * DELETE — desconecta: apaga a assinatura no Calendly (melhor esforço) e a
 * config. Os eventos recebidos FICAM, para o histórico.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { access_token?: unknown } | null;
    const token = typeof corpo?.access_token === "string" ? corpo.access_token.trim() : "";
    if (token.length < 20) return NextResponse.json({ error: "token_invalido" }, { status: 400 });

    const r = await conectarCalendly(supabaseAdmin(), ctx.accountId, ctx.userId, token, origemPublica(new URL(request.url).origin));
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : 400;
      return NextResponse.json({ error: r.codigo }, { status });
    }
    return NextResponse.json({ ok: true, usuario: r.usuario, escopo: r.escopo, webhookErro: r.webhookErro });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { pergunta_telefone?: unknown } | null;
    if (corpo === null || !("pergunta_telefone" in corpo)) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    const pergunta = typeof corpo.pergunta_telefone === "string" ? corpo.pergunta_telefone.trim().slice(0, 120) : "";
    const { data, error } = await supabaseAdmin()
      .from("cb_calendly_config")
      .update({ pergunta_telefone: pergunta || null, updated_at: new Date().toISOString() })
      .eq("account_id", ctx.accountId)
      .select("account_id");
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!data || data.length === 0) return NextResponse.json({ error: "nao_conectado" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarCalendly(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
