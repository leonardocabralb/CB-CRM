import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cartaoDoCalendly, type ConfigDoCalendly, type EventoDoCalendly } from "@/lib/calendly/cartao";
import { conferirAssinatura, origemPublica, urlDoWebhook } from "@/lib/calendly/conexao";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { COLUNAS_DO_EVENTO, EVENTOS_POR_PAGINA } from "@/lib/calendly/log";

/**
 * GET /api/cb/calendly  (admin+)
 *
 * O cartão "Calendly" da aba Integrações: estado, quem conectou, a
 * assinatura do webhook, a pergunta do telefone e os últimos eventos
 * recebidos com o que aconteceu a cada um. ⚠️ Token, chave de assinatura e
 * token de webhook NÃO saem daqui — a linha é lida com service role e
 * devolvida sem essas colunas. A URL do webhook é devolvida só como
 * informação de tela (para o operador conferir no Calendly), e ela contém
 * o token de rota: quem já é admin da conta a enxerga; ninguém mais.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    // O estado da assinatura vem do Calendly, não só da coluna: ele a
    // desativa depois de 24h de falhas sem avisar (Codex, PR #128).
    await conferirAssinatura(admin, ctx.accountId);
    const [config, eventos] = await Promise.all([
      admin
        .from("cb_calendly_config")
        .select("user_name, user_email, scheduling_url, webhook_uri, webhook_scope, webhook_state, webhook_token, pergunta_telefone, status, last_event_at, last_error")
        .eq("account_id", ctx.accountId)
        .maybeSingle(),
      // A primeira página do log (20); as demais vêm de `/eventos?pagina=N`.
      admin
        .from("cb_calendly_eventos")
        .select(COLUNAS_DO_EVENTO, { count: "exact" })
        .eq("account_id", ctx.accountId)
        .order("recebido_em", { ascending: false })
        .range(0, EVENTOS_POR_PAGINA - 1),
    ]);
    if (config.error || eventos.error) {
      return NextResponse.json({ error: "Não foi possível ler a integração." }, { status: 500 });
    }

    const linha = (config.data ?? null) as (ConfigDoCalendly & { webhook_token: string }) | null;
    const origem = origemPublica(new URL(request.url).origin);
    return NextResponse.json({
      cartao: cartaoDoCalendly(linha, (eventos.data ?? []) as EventoDoCalendly[]),
      eventos: eventos.data ?? [],
      totalEventos: eventos.count ?? 0,
      webhookUrl: linha && origem ? urlDoWebhook(origem, linha.webhook_token) : null,
      origemAlcancavel: origem !== null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
