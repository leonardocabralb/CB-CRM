import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";
import { criarClienteZapSign, MAX_PAGINAS_DE_MODELOS, ZapSignError, type ModeloDoZapSign } from "@/lib/zapsign/cliente";
import { registrarConferencia } from "@/lib/zapsign/conexao";

/**
 * GET /api/cb/zapsign/modelos  (admin+)
 *
 * Os modelos da conta no ZapSign, paginados AQUI (20 por página, até
 * `MAX_PAGINAS_DE_MODELOS`). `truncado` = havia mais: a tela diz "mais de
 * N", nunca um número menor com cara de certo. É também a conferência do
 * token: 401/403 marca a conexão em erro (`registrarConferencia`).
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:zapsign:status:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const admin = supabaseAdmin();
    const { data: config, error } = await admin
      .from("cb_zapsign_config")
      .select("api_token")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!config) return NextResponse.json({ error: "nao_conectado" }, { status: 404 });
    let token: string;
    try {
      token = decrypt(config.api_token as string);
    } catch {
      return NextResponse.json({ error: "token_ilegivel" }, { status: 500 });
    }

    const cliente = criarClienteZapSign(token);
    const modelos: ModeloDoZapSign[] = [];
    let truncado = false;
    try {
      for (let pagina = 1; pagina <= MAX_PAGINAS_DE_MODELOS; pagina++) {
        const p = await cliente.modelos(pagina);
        modelos.push(...p.modelos);
        if (!p.temMais || p.modelos.length === 0) break;
        if (pagina === MAX_PAGINAS_DE_MODELOS) truncado = true;
      }
    } catch (e) {
      const codigo = e instanceof ZapSignError ? e.codigo : "zapsign_error";
      console.warn(`[zapsign] modelos não lidos (${codigo}):`, e instanceof Error ? e.message : e);
      await registrarConferencia(admin, ctx.accountId, codigo);
      return NextResponse.json({ error: codigo }, { status: 502 });
    }
    await registrarConferencia(admin, ctx.accountId, null);
    return NextResponse.json({ modelos, truncado });
  } catch (err) {
    return toErrorResponse(err);
  }
}
