import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { liberarClaim, motivoDaRecusa, reivindicarEvento } from "@/lib/calendly/claim";
import { gravarResultado, processarAgendamento } from "@/lib/calendly/processar";
import { agendamentoDaLinha, varsDaLinha } from "@/lib/calendly/reprocessar";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/calendly/eventos/[id]/reprocessar  (admin+)
 *
 * "Processar de novo": roda o agendamento que já está gravado, com as
 * variáveis que ele entregou da primeira vez (979).
 *
 * Existe porque a razão de um agendamento não ter disparado costuma ser
 * passageira e externa: a automação ainda não existia ou estava desligada,
 * ou o CRM não conseguiu criar a ficha do cliente. O operador arruma o que
 * faltava e pede a repetição.
 *
 * ⚠️⚠️ Passa pelo CADEADO (`reivindicarEvento`, 980) — nunca por "ler o
 * estado e então processar". Isto MANDA MENSAGEM: dois cliques simultâneos,
 * ou um clique enquanto o `after()` do webhook ainda roda, dariam dois
 * avisos ao advogado e mexeriam no card duas vezes. Quem consegue escrever
 * o cadeado é o dono; os demais recebem 409 com o motivo real.
 *
 * ⚠️ Só linha REPROCESSÁVEL é reivindicável (`RESULTADOS_REPROCESSAVEIS`):
 * repetir um `disparado` mandaria a mesma mensagem de novo, e em `falhou`
 * não se sabe se o passo de envio já tinha rodado (aí o caminho é o
 * histórico da automação e o "Executar automação" da conversa).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:calendly:reprocessar:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const admin = supabaseAdmin();

    const { linha, erro } = await reivindicarEvento(admin, { id, accountId: ctx.accountId });
    if (erro) return NextResponse.json({ error: "db_error" }, { status: 500 });

    if (!linha) {
      // Não pegou. O motivo vem do estado REAL — e erro de banco aqui NÃO é
      // "não encontrado": um blip viraria 404 e o operador concluiria que o
      // agendamento sumiu do log.
      const { data: atual, error: erroLeitura } = await admin
        .from("cb_calendly_eventos")
        .select("resultado, processando_desde")
        .eq("id", id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
      const motivo = motivoDaRecusa(atual, Date.now());
      return NextResponse.json({ error: motivo }, { status: motivo === "not_found" ? 404 : 409 });
    }

    const agendamento = agendamentoDaLinha(linha);
    if (!agendamento) {
      await liberarClaim(admin, id);
      return NextResponse.json({ error: "linha_incompleta" }, { status: 422 });
    }

    try {
      const r = await processarAgendamento(admin, ctx.accountId, agendamento, varsDaLinha(linha, agendamento));
      await gravarResultado(admin, id, r);
      return NextResponse.json({ ok: true, resultado: r.resultado, detalhe: r.detalhe });
    } catch (e) {
      // ⚠️ Estourou DEPOIS do cadeado: a automação pode ter mandado
      // mensagem antes de morrer. Grava `falhou` — que não é reprocessável —
      // em vez de soltar o cadeado limpo, senão o próximo clique repetiria
      // um envio que talvez tenha saído. `gravarResultado` solta o cadeado.
      await gravarResultado(admin, id, {
        resultado: "falhou",
        detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido",
        contactId: null,
      });
      return NextResponse.json({ error: "processamento_falhou" }, { status: 500 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
