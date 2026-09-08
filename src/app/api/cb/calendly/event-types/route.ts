import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CalendlyError, criarClienteCalendly } from "@/lib/calendly/cliente";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { decrypt } from "@/lib/whatsapp/encryption";

/**
 * GET /api/cb/calendly/event-types  (admin+)
 *
 * Os tipos de evento do Calendly, para o select do gatilho
 * `calendly_booking`. Organização primeiro; se o token não enxerga a
 * organização (403), os do próprio usuário. Sem conexão → 404
 * `nao_conectado`, que a tela traduz num link para Integrações.
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:tipos:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { data: config, error } = await supabaseAdmin()
      .from("cb_calendly_config")
      .select("access_token, user_uri, organization_uri")
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!config) return NextResponse.json({ error: "nao_conectado" }, { status: 404 });

    let token: string;
    try {
      token = decrypt(config.access_token);
    } catch {
      return NextResponse.json({ error: "chave_ilegivel" }, { status: 500 });
    }
    const cliente = criarClienteCalendly(token);
    try {
      let tipos;
      try {
        tipos = await cliente.tiposDeEvento({ organization: config.organization_uri });
      } catch (e) {
        if (!(e instanceof CalendlyError) || e.codigo !== "sem_permissao") throw e;
        tipos = await cliente.tiposDeEvento({ user: config.user_uri });
      }
      // Ativos primeiro, depois por nome — o inativo continua na lista
      // porque uma automação gravada com ele precisa mostrar o que escolheu.
      tipos.sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome));
      return NextResponse.json({ tipos });
    } catch (e) {
      const codigo = e instanceof CalendlyError ? e.codigo : "calendly_error";
      console.warn(`[calendly] tipos de evento (${codigo}):`, e instanceof Error ? e.message : e);
      return NextResponse.json({ error: codigo }, { status: 502 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
