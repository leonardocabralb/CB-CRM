import { NextResponse } from "next/server";

import { cartaoDoAtlas, type ConfigDoAtlas } from "@/lib/atlas/cartao";
import { conectarAtlas, conferirConexao, desconectarAtlas } from "@/lib/atlas/conexao";
import { ambienteDoAtlas } from "@/lib/atlas/enderecos";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * /api/cb/atlas  (admin+) — o cartão "Atlas" da aba Integrações (1071).
 *
 * GET — o estado da conexão e de qual escritório do Atlas é a chave.
 *   ⚠️ A chave NÃO sai daqui: a linha é lida com service role SEM a coluna.
 * POST — `{ chave }` conecta (ou troca a chave): prova pelo `whoami` do
 *   Atlas, que não grava nada lá; recusa com `permissoes_faltando` (e a
 *   lista) quando o escritório não liberou o que o passo usa.
 * PATCH — "Conferir de novo": refaz o `whoami` com a chave GUARDADA (nada é
 *   gravado no Atlas). É a saída do aviso de permissão desligada sem colar a
 *   chave outra vez.
 * DELETE — desconecta. Os vínculos das fichas ficam (o mesmo escritório,
 *   reconectado, os reaproveita).
 *
 * ⚠️ A instância apontada para outro ambiente do Atlas (`ATLAS_API_URL`, o
 * preview contra o staging) não conecta por cima nem apaga a conexão de
 * outro ambiente: responde `outro_ambiente` (ver `conexao.ts`).
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data, error } = await supabaseAdmin()
      .from("cb_atlas_config")
      .select("api_url, escritorio, status, last_error, conectado_em, conferido_em")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    return NextResponse.json({ cartao: cartaoDoAtlas((data ?? null) as ConfigDoAtlas | null, ambienteDoAtlas()) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const corpo = (await request.json().catch(() => null)) as { chave?: unknown } | null;
    const chave = typeof corpo?.chave === "string" ? corpo.chave.trim() : "";
    // Tamanho plausível (a do Atlas tem ~51 caracteres). Texto com espaço no
    // meio é cola errada: a chave nunca tem. Código PRÓPRIO: o Atlas nem viu.
    if (chave.length < 20 || chave.length > 200 || /\s/.test(chave)) {
      return NextResponse.json({ error: "chave_mal_colada" }, { status: 400 });
    }
    const r = await conectarAtlas(supabaseAdmin(), ctx.accountId, ctx.userId, chave);
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "outro_ambiente" ? 409 : 400;
      return NextResponse.json({ error: r.codigo, ...(r.faltando ? { faltando: r.faltando } : {}) }, { status });
    }
    return NextResponse.json({ ok: true, escritorio: r.escritorio });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await conferirConexao(supabaseAdmin(), ctx.accountId);
    if (!r.ok) {
      const status = r.codigo === "db_error" ? 500 : r.codigo === "outro_ambiente" ? 409 : 400;
      return NextResponse.json({ error: r.codigo, ...(r.faltando ? { faltando: r.faltando } : {}) }, { status });
    }
    return NextResponse.json({ ok: true, escritorio: r.escritorio });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:atlas:config:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const r = await desconectarAtlas(supabaseAdmin(), ctx.accountId);
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.codigo === "outro_ambiente" ? 409 : 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
