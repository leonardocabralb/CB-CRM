import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { criarClienteMeta, MetaAdsError, normalizarAdAccountId } from "@/lib/meta-ads/cliente";
import { sincronizarMetaAds } from "@/lib/meta-ads/sincronizar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { encrypt } from "@/lib/whatsapp/encryption";

/**
 * PUT /api/cb/meta-ads/config  (admin+) — conecta (ou troca) a conta de anúncios.
 *
 * Corpo: `{ ad_account_id, access_token }`. O token é TESTADO na hora
 * (`GET /act_<id>?fields=name,currency`) e guardado CIFRADO; falha volta
 * como CÓDIGO (`token_invalido`, `sem_permissao`, `conta_nao_encontrada`,
 * `limite`, `rede`, `meta_error`), nunca a mensagem crua da Meta. Depois de
 * gravar, a primeira sincronização (90 dias) roda em `after()`.
 *
 * DELETE — desconecta: apaga a config. Campanhas e gastos FICAM, para o
 * histórico do Desempenho não sumir.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { ad_account_id?: unknown; access_token?: unknown } | null;
    const adAccountId = typeof corpo?.ad_account_id === "string" ? normalizarAdAccountId(corpo.ad_account_id) : null;
    const token = typeof corpo?.access_token === "string" ? corpo.access_token.trim() : "";
    if (!adAccountId) return NextResponse.json({ error: "conta_invalida" }, { status: 400 });
    if (token.length < 20) return NextResponse.json({ error: "token_invalido" }, { status: 400 });

    let conta;
    try {
      conta = await criarClienteMeta(token).conta(adAccountId);
    } catch (e) {
      const codigo = e instanceof MetaAdsError ? e.codigo : "meta_error";
      console.warn(`[meta-ads] conexão recusada (${codigo}):`, e instanceof Error ? e.message : e);
      return NextResponse.json({ error: codigo }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const agora = new Date().toISOString();
    const { error } = await admin.from("cb_meta_ads_config").upsert(
      {
        account_id: ctx.accountId,
        ad_account_id: adAccountId,
        access_token: encrypt(token),
        nome_da_conta: conta.nome,
        moeda: conta.moeda,
        status: "conectado",
        last_error: null,
        last_sync_at: null,
        created_by: ctx.userId,
        updated_at: agora,
      },
      { onConflict: "account_id" },
    );
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });

    // O `after()` sobrevive à resposta; o client RLS do pedido, não — por
    // isso o admin é criado dentro.
    after(async () => {
      await sincronizarMetaAds(supabaseAdmin(), ctx.accountId, { primeira: true });
    });

    return NextResponse.json({ ok: true, conta: { id: conta.id, nome: conta.nome, moeda: conta.moeda } });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { error } = await supabaseAdmin().from("cb_meta_ads_config").delete().eq("account_id", ctx.accountId);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
