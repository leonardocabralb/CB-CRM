import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { cartaoDoTldv, type ConfigDoTldv } from "@/lib/tldv/cartao";
import { origemPublica, urlDoWebhook } from "@/lib/tldv/conexao";

/** As últimas reuniões importadas, no cartão. */
export const REUNIOES_NO_CARTAO = 20;

/**
 * GET /api/cb/tldv  (admin+)
 *
 * O cartão "tl;dv" da aba Integrações: estado, última sincronização,
 * contagens e as últimas reuniões importadas (com o cliente de cada uma).
 * ⚠️ A chave NÃO sai daqui, nem mascarada — a linha é lida com service role
 * e devolvida sem a coluna. A URL do webhook é informação de tela (para o
 * operador colar no tl;dv) e carrega o token de rota: quem já é admin da
 * conta a enxerga; ninguém mais.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:tldv:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const base = () => admin.from("cb_reunioes_transcritas").select("id", { count: "exact", head: true }).eq("account_id", ctx.accountId).eq("origem", "tldv");
    const [config, total, prontas, pendentes, semCliente, recentes] = await Promise.all([
      admin.from("cb_tldv_config").select("status, last_sync_at, last_event_at, last_error, webhook_token").eq("account_id", ctx.accountId).maybeSingle(),
      base(),
      base().eq("status", "pronta"),
      base().eq("status", "pendente"),
      base().is("contact_id", null),
      admin
        .from("cb_reunioes_transcritas")
        .select("id, titulo, realizada_em, duracao_seg, status, contact_id, url, vinculo_origem, erro, participantes")
        .eq("account_id", ctx.accountId)
        .eq("origem", "tldv")
        .order("realizada_em", { ascending: false })
        .limit(REUNIOES_NO_CARTAO),
    ]);
    if (config.error || total.error || prontas.error || pendentes.error || semCliente.error || recentes.error) {
      return NextResponse.json({ error: "Não foi possível ler a integração." }, { status: 500 });
    }

    // O nome do cliente de cada linha, numa consulta só.
    const linhas = (recentes.data ?? []) as { contact_id: string | null; [k: string]: unknown }[];
    const idsDeContato = [...new Set(linhas.map((l) => l.contact_id).filter((id): id is string => id !== null))];
    const nomes = new Map<string, string>();
    if (idsDeContato.length > 0) {
      const { data: contatos } = await admin.from("contacts").select("id, name, phone").eq("account_id", ctx.accountId).in("id", idsDeContato);
      for (const c of (contatos ?? []) as { id: string; name: string | null; phone: string }[]) nomes.set(c.id, c.name || c.phone);
    }

    const linha = (config.data ?? null) as (ConfigDoTldv & { webhook_token: string }) | null;
    const origem = origemPublica(new URL(request.url).origin);
    return NextResponse.json({
      cartao: cartaoDoTldv(linha, {
        total: total.count ?? 0,
        prontas: prontas.count ?? 0,
        pendentes: pendentes.count ?? 0,
        semCliente: semCliente.count ?? 0,
      }),
      reunioes: linhas.map((l) => ({ ...l, contato_nome: l.contact_id ? (nomes.get(l.contact_id) ?? null) : null })),
      webhookUrl: linha && origem ? urlDoWebhook(origem, linha.webhook_token) : null,
      origemAlcancavel: origem !== null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
