import { NextResponse, after } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { sincronizarTldv } from "@/lib/tldv/sincronizar";

/**
 * POST /api/cb/tldv/sync  (admin+) — "Sincronizar agora".
 * Responde 202 e trabalha em `after()`: é o MESMO código do cron.
 */
export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:tldv:sync:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    after(async () => {
      await sincronizarTldv(supabaseAdmin(), ctx.accountId);
    });
    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
