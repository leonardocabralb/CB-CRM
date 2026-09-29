// ============================================================
// POST /api/account/members/[userId]/suspensao   { suspenso: boolean }
//
// Suspende ou reativa o acesso de um membro (1064). Admin+.
//
// Quem decide é a RPC `cb_definir_suspensao` (SECURITY DEFINER): admin ou
// dono, nunca o dono como alvo, nunca a si mesmo, só membro da própria conta
// — a régua do remover. Esta rota só repassa e traduz os SQLSTATE. Nada é
// apagado nem reatribuído: reativar devolve o acesso como era.
//
// Rota nova, e não um ramo do PATCH de `[userId]`, de propósito: aquele
// arquivo é do upstream e valida `role` com rigor; misturar os dois corpos
// num handler só complicaria o merge e a validação.
// ============================================================

import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

// O mesmo filtro da rota `transfer-ownership`: id que não é UUID viraria um
// 22P02 no banco, e a rota responderia 500 com log de erro.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberSuspend:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;
    if (!UUID.test(userId)) {
      return NextResponse.json(
        { error: "'userId' must be a valid UUID" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      suspenso?: unknown;
    } | null;
    const suspenso = body?.suspenso;
    if (typeof suspenso !== "boolean") {
      return NextResponse.json(
        { error: "'suspenso' must be true or false" },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase.rpc("cb_definir_suspensao", {
      p_user_id: userId,
      p_suspenso: suspenso,
    });

    if (error) {
      // Os SQLSTATE da RPC (1064): 42501 = sem permissão para isto;
      // 22023 = alvo inválido (o dono, a si mesmo, alguém que não existe).
      if (error.code === "42501") {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
      if (error.code === "22023") {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      console.error("[POST suspensao] unexpected RPC error:", {
        code: error.code,
        message: error.message,
      });
      return NextResponse.json(
        { error: "Failed to update member" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      suspenso_em: typeof data === "string" ? data : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
