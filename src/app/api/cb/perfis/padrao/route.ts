// ============================================================
// POST /api/cb/perfis/padrao — semear os perfis de fábrica.
//
// Chamado pelo botão "Criar perfis padrão" do painel quando a lista está
// vazia — botão, e não semeadura automática na primeira visita: escrever na
// conta sem um clique explícito do admin seria surpresa, e a migration não
// semeia porque perfil é dado de conta, não schema.
//
// Idempotente por nome: perfil homônimo existente é PULADO, nunca
// sobrescrito — o operador pode ter editado o "Advogado" dele.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { PERFIS_DE_FABRICA } from "@/lib/perfis/padroes";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(
      `admin:perfis:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const existentes = await supabaseAdmin()
      .from("cb_perfis_de_acesso")
      .select("nome")
      .eq("account_id", ctx.accountId);
    if (existentes.error) {
      console.error("[POST /api/cb/perfis/padrao] load error:", existentes.error);
      return NextResponse.json(
        { error: "Falha ao conferir os perfis existentes" },
        { status: 500 },
      );
    }

    const jaTem = new Set(
      (existentes.data ?? []).map((p: { nome: string }) => p.nome.toLowerCase()),
    );
    const faltantes = PERFIS_DE_FABRICA.filter(
      (p) => !jaTem.has(p.nome.toLowerCase()),
    );
    if (faltantes.length === 0) {
      return NextResponse.json({ ok: true, criados: 0 });
    }

    const { error } = await supabaseAdmin().from("cb_perfis_de_acesso").insert(
      faltantes.map((p) => ({
        account_id: ctx.accountId,
        nome: p.nome,
        papel_base: p.papel_base,
        telas: p.telas,
        secoes_config: p.secoes_config,
        sistema: p.sistema,
      })),
    );
    if (error) {
      console.error("[POST /api/cb/perfis/padrao] insert error:", error);
      return NextResponse.json(
        { error: "Não foi possível criar os perfis padrão" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, criados: faltantes.length });
  } catch (err) {
    return toErrorResponse(err);
  }
}
