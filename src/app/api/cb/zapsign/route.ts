import { NextResponse } from "next/server";

import { origemPublica, podeCriarDaqui } from "@/lib/asaas/webhook";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { cartaoDoZapSign, type ConfigDoZapSign, type EventoDoZapSign } from "@/lib/zapsign/cartao";
import { conectarZapSign, desconectarZapSign, reativarWebhook, urlDoWebhook } from "@/lib/zapsign/conexao";
import { COLUNAS_DO_EVENTO, EVENTOS_POR_PAGINA } from "@/lib/zapsign/log";

/**
 * /api/cb/zapsign  (admin+) — o cartão "ZapSign" da aba Integrações.
 *
 * GET — estado, plano, o webhook, e a primeira página do log de assinaturas.
 *   ⚠️ O token da API e a credencial do webhook NÃO saem daqui: a linha é
 *   lida com service role SEM essas colunas. A URL do webhook sai só como
 *   informação de tela (para conferir no painel do ZapSign); ela carrega o
 *   token de ROTA, não a credencial.
 * POST — `{ token }` conecta (ou troca o token); `{ acao: "reativar_webhook" }`
 *   recria o webhook. Os dois só mexem em webhook a partir do host público
 *   (`podeCriarDaqui`) — ver `conexao.ts`.
 * DELETE — desconecta: apaga o webhook no ZapSign e a config. O log e os
 *   documentos FICAM, para o histórico.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:zapsign:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const [config, eventos] = await Promise.all([
      admin
        .from("cb_zapsign_config")
        .select("plano, webhook_estado, status, last_error, last_event_at, conectado_em, conferido_em, webhook_url_token")
        .eq("account_id", ctx.accountId)
        .maybeSingle(),
      admin
        .from("cb_zapsign_eventos")
        .select(COLUNAS_DO_EVENTO, { count: "exact" })
        .eq("account_id", ctx.accountId)
        .order("recebido_em", { ascending: false })
        .range(0, EVENTOS_POR_PAGINA - 1),
    ]);
    if (config.error || eventos.error) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    const linha = (config.data ?? null) as (ConfigDoZapSign & { webhook_url_token: string }) | null;
    const origem = origemPublica();
    return NextResponse.json({
      cartao: cartaoDoZapSign(linha, (eventos.data ?? []) as unknown as EventoDoZapSign[]),
      eventos: eventos.data ?? [],
      totalEventos: eventos.count ?? 0,
      webhookUrl: linha && origem ? urlDoWebhook(origem, linha.webhook_url_token) : null,
      origemAlcancavel: origem !== null,
      podeCriarAqui: podeCriarDaqui(origem, request),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:zapsign:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { token?: unknown; acao?: unknown } | null;
    const origem = origemPublica();
    const opcoes = { origem, podeCriarWebhook: podeCriarDaqui(origem, request) };

    if (corpo?.acao === "reativar_webhook") {
      const r = await reativarWebhook(supabaseAdmin(), ctx.accountId, opcoes);
      if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "db_error" ? 500 : 400 });
      return NextResponse.json({ ok: true });
    }

    const token = typeof corpo?.token === "string" ? corpo.token.trim() : "";
    // Tamanho plausível: o token do ZapSign é um uuid-ish (36). Texto com
    // espaço no meio é cola errada (o token nunca tem).
    if (token.length < 20 || token.length > 200 || /\s/.test(token)) {
      return NextResponse.json({ error: "token_invalido" }, { status: 400 });
    }
    const r = await conectarZapSign(supabaseAdmin(), ctx.accountId, ctx.userId, token, opcoes);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "db_error" ? 500 : 400 });
    return NextResponse.json({ ok: true, plano: r.plano, webhook: r.webhook, webhookErro: r.webhookErro });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:zapsign:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarZapSign(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: 500 });
    return NextResponse.json({ ok: true, webhookNaoApagado: r.webhookNaoApagado });
  } catch (err) {
    return toErrorResponse(err);
  }
}
