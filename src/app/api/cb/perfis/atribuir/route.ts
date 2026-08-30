// ============================================================
// PATCH /api/cb/perfis/atribuir — dar (ou tirar) o perfil de um membro.
//
// Corpo: { userId, perfilId | null }.
//
// É UM UPDATE só em `profiles`: `perfil_id` e `account_role = papel_base`
// juntos, atômico por ser uma linha — a sincronia papel↔perfil não precisa
// de RPC aqui (diferente da EDIÇÃO do perfil, 959, que toca duas tabelas).
//
// perfilId nulo = voltar a "sem restrição" e MANTER o papel atual: tirar o
// perfil não é rebaixar a pessoa — o papel continua sendo a fonte da verdade
// e só muda quando um perfil o define.
//
// Travas:
//   - o alvo tem de ser membro DESTA conta (service-role ignora RLS; sem o
//     escopo, um id de outra conta seria aceito — a FK composta da 957 até
//     barraria o perfil_id cruzado, mas não um account_role reescrito);
//   - o DONO não recebe perfil: o papel dele não vem de perfil, e rebaixá-lo
//     seria transferência de posse por acidente;
//   - quem chama não se tira de admin (anti-auto-bloqueio).
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(
      `admin:perfis:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      userId?: unknown;
      perfilId?: unknown;
    } | null;
    const userId = typeof body?.userId === "string" ? body.userId : null;
    const perfilId =
      body?.perfilId === null
        ? null
        : typeof body?.perfilId === "string"
          ? body.perfilId
          : undefined;
    if (!userId || perfilId === undefined) {
      return NextResponse.json(
        { error: "Corpo inválido: userId e perfilId (ou null) são obrigatórios" },
        { status: 400 },
      );
    }

    // O alvo é membro DESTA conta?
    const alvo = await supabaseAdmin()
      .from("profiles")
      .select("user_id, account_role")
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (alvo.error) {
      console.error("[atribuir] load error:", alvo.error);
      return NextResponse.json(
        { error: "Falha ao carregar o membro" },
        { status: 500 },
      );
    }
    if (!alvo.data) {
      return NextResponse.json(
        { error: "Membro não encontrado nesta conta" },
        { status: 404 },
      );
    }
    if (alvo.data.account_role === "owner") {
      return NextResponse.json(
        { error: "O proprietário não recebe perfil — ele enxerga tudo por definição" },
        { status: 409 },
      );
    }

    let novoPapel: string | null = null;
    if (perfilId !== null) {
      const perfil = await supabaseAdmin()
        .from("cb_perfis_de_acesso")
        .select("id, papel_base")
        .eq("id", perfilId)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (perfil.error) {
        console.error("[atribuir] perfil load error:", perfil.error);
        return NextResponse.json(
          { error: "Falha ao carregar o perfil" },
          { status: 500 },
        );
      }
      if (!perfil.data) {
        return NextResponse.json(
          { error: "Perfil não encontrado nesta conta" },
          { status: 404 },
        );
      }
      novoPapel = perfil.data.papel_base;

      // Anti-auto-bloqueio: o admin não se move para um perfil não-admin.
      if (userId === ctx.userId && novoPapel !== "admin") {
        return NextResponse.json(
          {
            error:
              "Você não pode se mover para um perfil que não é de administrador — perderia a tela que desfaz isso",
          },
          { status: 409 },
        );
      }
    }

    const { error } = await supabaseAdmin()
      .from("profiles")
      .update(
        perfilId === null
          ? { perfil_id: null }
          : { perfil_id: perfilId, account_role: novoPapel },
      )
      .eq("user_id", userId)
      .eq("account_id", ctx.accountId);
    if (error) {
      console.error("[atribuir] update error:", error);
      return NextResponse.json(
        { error: "Não foi possível atribuir o perfil" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
