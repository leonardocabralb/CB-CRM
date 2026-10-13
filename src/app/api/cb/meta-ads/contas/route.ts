import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { criarClienteMeta, MetaAdsError } from "@/lib/meta-ads/cliente";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/meta-ads/contas  (admin+) — as contas de anúncios que um
 * token enxerga, para o cartão oferecer a escolha antes de conectar.
 *
 * Corpo: `{ access_token }`. POST, e não GET, porque o token não pode ir na
 * URL (log de proxy). Nada é gravado: quem grava é o `PUT config`, com a
 * conta escolhida, e ele testa o token de novo. Falha volta como CÓDIGO,
 * como lá; lista vazia é resposta (o token vale, mas o usuário de sistema
 * não recebeu conta nenhuma), e a tela diz isso.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:metaAds:contas:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { access_token?: unknown } | null;
    const token = typeof corpo?.access_token === "string" ? corpo.access_token.trim() : "";
    if (token.length < 20) return NextResponse.json({ error: "token_invalido" }, { status: 400 });

    try {
      const contas = await criarClienteMeta(token).contas();
      return NextResponse.json({ contas });
    } catch (e) {
      const codigo = e instanceof MetaAdsError ? e.codigo : "meta_error";
      console.warn(`[meta-ads] listar contas recusado (${codigo}):`, e instanceof Error ? e.message : e);
      return NextResponse.json({ error: codigo }, { status: 400 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
