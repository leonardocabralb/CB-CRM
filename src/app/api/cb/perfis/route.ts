// ============================================================
// POST /api/cb/perfis — criar um perfil de acesso.
//
// Mesmo modelo de cb_tasks: o navegador NÃO escreve na tabela (a 956 não
// tem policy de escrita e revogou o privilégio — 42501); toda escrita passa
// por aqui, em service-role, depois do `requireRole('admin')`.
//
// ⚠️ Service-role ignora RLS: TODA consulta carrega `.eq('account_id', …)`
// explícito — regra das rotas v1 no CLAUDE.md, e é exatamente o engano que a
// FK composta da 957 existe para conter.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { validarCorpoDePerfil } from "@/lib/perfis/validar";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(
      `admin:perfis:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const v = validarCorpoDePerfil(body);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });

    const { data, error } = await supabaseAdmin()
      .from("cb_perfis_de_acesso")
      .insert({
        account_id: ctx.accountId,
        ...v.perfil,
        sistema: false, // perfil de fábrica só nasce pela rota /padrao
      })
      .select("id")
      .single();

    if (error) {
      // 23505 = UNIQUE (account_id, lower(nome)) — dois perfis homônimos são
      // sempre erro de digitação, e o seletor ficaria impossível de usar.
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um perfil com este nome" },
          { status: 409 },
        );
      }
      console.error("[POST /api/cb/perfis] insert error:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o perfil" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
