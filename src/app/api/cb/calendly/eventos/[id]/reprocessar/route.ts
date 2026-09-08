import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { RESULTADOS_REPROCESSAVEIS } from "@/lib/calendly/log";
import { agendamentoDaLinha, varsDaLinha } from "@/lib/calendly/reprocessar";
import { gravarResultado, processarAgendamento } from "@/lib/calendly/processar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/calendly/eventos/[id]/reprocessar  (admin+)
 *
 * "Processar de novo": roda o agendamento que já está gravado, com as
 * variáveis que ele entregou da primeira vez (979).
 *
 * Existe porque a razão de um agendamento não ter disparado costuma ser
 * passageira e externa: o telefone ainda não era de nenhum contato (a ficha
 * nasce segundos depois — ver `processar.ts`), ou a automação ainda não
 * existia/estava desligada. O caminho automático já tenta de novo por
 * alguns minutos; este é para depois disso, quando o operador arrumou o que
 * faltava.
 *
 * ⚠️ NÃO re-tenta o que já rodou (`RESULTADOS_REPROCESSAVEIS`): repetir um
 * `disparado` mandaria a mesma mensagem à equipe outra vez. Sem retentativa
 * com espera aqui — é um clique, a resposta tem de voltar.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:reprocessar:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const admin = supabaseAdmin();
    const { data: linha, error } = await admin
      .from("cb_calendly_eventos")
      .select("*")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    // Erro de banco NÃO é "não encontrado" — senão um blip vira 404 e o
    // operador conclui que o agendamento sumiu do log.
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!linha) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (!(RESULTADOS_REPROCESSAVEIS as readonly string[]).includes(linha.resultado)) {
      return NextResponse.json({ error: "ja_processado", resultado: linha.resultado }, { status: 409 });
    }

    const agendamento = agendamentoDaLinha(linha);
    if (!agendamento) return NextResponse.json({ error: "linha_incompleta" }, { status: 422 });

    const r = await processarAgendamento(admin, ctx.accountId, agendamento, varsDaLinha(linha, agendamento));
    await gravarResultado(admin, id, r);
    return NextResponse.json({ ok: true, resultado: r.resultado, detalhe: r.detalhe });
  } catch (err) {
    return toErrorResponse(err);
  }
}
