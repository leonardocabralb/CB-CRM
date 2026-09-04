import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { cartaoDoMetaAds, type CampanhaDoMetaAds, type ConfigDoMetaAds } from "@/lib/meta-ads/cartao";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/meta-ads  (admin+)
 *
 * O cartão "Meta Ads" da aba Integrações: estado, conta, última
 * sincronização, campanhas (com o funil de cada uma) e os funis da conta
 * para o seletor. ⚠️ O token NÃO sai daqui, nem mascarado — a linha de
 * config é lida com service role e devolvida sem a coluna.
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const [config, campanhas, funis] = await Promise.all([
      admin
        .from("cb_meta_ads_config")
        .select("ad_account_id, nome_da_conta, moeda, status, last_sync_at, last_error")
        .eq("account_id", ctx.accountId)
        .maybeSingle(),
      admin
        .from("cb_meta_ads_campanhas")
        .select("id, campaign_id, nome, status_meta, pipeline_id, last_seen_at")
        .eq("account_id", ctx.accountId)
        .order("status_meta")
        .order("nome"),
      ctx.supabase.from("pipelines").select("id, name").order("name"),
    ]);
    if (config.error || campanhas.error || funis.error) {
      return NextResponse.json({ error: "Não foi possível ler a integração." }, { status: 500 });
    }

    const linhas = (campanhas.data ?? []) as CampanhaDoMetaAds[];
    return NextResponse.json({
      cartao: cartaoDoMetaAds((config.data as ConfigDoMetaAds | null) ?? null, linhas),
      campanhas: linhas,
      funis: funis.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
