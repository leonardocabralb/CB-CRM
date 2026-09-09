import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { validarTranscricaoManual } from "@/lib/reunioes-transcritas/validar";

/**
 * POST /api/cb/reunioes-transcritas  (agent+) — a transcrição colada à mão.
 *
 * Corpo: `{ contact_id, titulo, realizada_em, texto, duracao_seg?, url? }`.
 * Nasce `pronta`, origem `manual`, vinculada ao cliente (vínculo `manual`),
 * com autor carimbado. A leitura é direta sob RLS (987) — não há GET aqui.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const limit = checkRateLimit(`cb:reunioes-transcritas:${ctx.userId}`, RATE_LIMITS.reuniaoTranscrita);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo: unknown = await request.json().catch(() => null);
    const v = validarTranscricaoManual(corpo);
    if (!v.ok) return NextResponse.json({ error: "invalido", campo: v.erro }, { status: 400 });

    const admin = supabaseAdmin();
    // ⚠️ Conferido contra a conta: a rota roda em service role e a FK
    // composta da 987 recusaria de qualquer jeito, mas com um erro que não
    // diz o que houve.
    const { data: contato } = await admin.from("contacts").select("id").eq("id", v.dados.contact_id).eq("account_id", ctx.accountId).maybeSingle();
    if (!contato) return NextResponse.json({ error: "contato_nao_encontrado" }, { status: 400 });

    const { data: perfil } = await ctx.supabase.from("profiles").select("full_name, email").eq("user_id", ctx.userId).maybeSingle();
    const autorNome = (perfil?.full_name as string | null) ?? (perfil?.email as string | null) ?? null;
    const agora = new Date().toISOString();

    const { data: criada, error } = await admin
      .from("cb_reunioes_transcritas")
      .insert({
        account_id: ctx.accountId,
        contact_id: v.dados.contact_id,
        origem: "manual",
        titulo: v.dados.titulo,
        realizada_em: v.dados.realizada_em,
        duracao_seg: v.dados.duracao_seg,
        url: v.dados.url,
        status: "pronta",
        texto: v.dados.texto,
        vinculo_origem: "manual",
        vinculado_por: ctx.userId,
        vinculado_em: agora,
        created_by: ctx.userId,
        autor_nome: autorNome,
      })
      .select("id, titulo, realizada_em, status, origem")
      .single();
    if (error || !criada) return NextResponse.json({ error: "db_error" }, { status: 500 });
    return NextResponse.json({ ok: true, reuniao: criada }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
