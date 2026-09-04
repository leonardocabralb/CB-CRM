import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { sincronizarMetaAds } from "@/lib/meta-ads/sincronizar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/meta-ads/sync  (admin+) — "Sincronizar agora".
 * Responde 202 e trabalha em `after()`: é o MESMO código do cron.
 */
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:sync:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    after(async () => {
      await sincronizarMetaAds(supabaseAdmin(), ctx.accountId);
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
