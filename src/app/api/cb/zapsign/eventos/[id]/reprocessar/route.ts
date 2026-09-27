import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { comTetoDeProcessamento, gravarResultado, motivoDaRecusa, reivindicarEvento } from "@/lib/zapsign/claim";
import { processarAssinatura } from "@/lib/zapsign/processar";
import { respostasGuardadas } from "@/lib/zapsign/variaveis";

/**
 * POST /api/cb/zapsign/eventos/[id]/reprocessar  (admin+)
 *
 * "Processar de novo": roda de novo uma assinatura gravada — relendo o
 * documento no ZapSign, como da primeira vez. Existe porque a razão de uma
 * assinatura não ter movido o card costuma ser externa e passageira: a ficha
 * do cliente não tinha o telefone (ou tinha dois clientes com o mesmo), a
 * automação ainda não existia, o ZapSign não respondeu.
 *
 * ⚠️⚠️ Passa pelo CADEADO (`reivindicarEvento`) — nunca "ler o estado e
 * então processar": isto move o card e pode mandar mensagem. Só linha
 * REPROCESSÁVEL é reivindicável (`RESULTADOS_REPROCESSAVEIS`); os demais
 * recebem 409 com o motivo real. Toda escrita leva a CERCA DE POSSE, e o
 * processamento tem TETO menor que o recolhimento.
 *
 * O documento que JÁ disparou por outra assinatura não dispara de novo: o
 * cadeado do disparo (`cb_zapsign_documentos.disparo_evento_id`) responde
 * `ignorado`.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:zapsign:reprocessar:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const admin = supabaseAdmin();

    const { linha, erro } = await reivindicarEvento(admin, { id, accountId: ctx.accountId });
    if (erro) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!linha) {
      // O motivo vem do estado REAL — e erro de banco aqui NÃO é "não
      // encontrado": o operador concluiria que a assinatura sumiu do log.
      const { data: atual, error: erroLeitura } = await admin
        .from("cb_zapsign_eventos")
        .select("resultado, processando_desde")
        .eq("id", id)
        .eq("account_id", ctx.accountId)
        .maybeSingle();
      if (erroLeitura) return NextResponse.json({ error: "db_error" }, { status: 500 });
      const motivo = motivoDaRecusa(atual, Date.now());
      return NextResponse.json({ error: motivo }, { status: motivo === "not_found" ? 404 : 409 });
    }

    const claimIso = String(linha.processando_desde);
    try {
      const r = await comTetoDeProcessamento(
        processarAssinatura(admin, ctx.accountId, {
          eventoId: id,
          docToken: String(linha.doc_token ?? ""),
          signerToken: String(linha.signer_token ?? ""),
          respostasDeQueda: respostasGuardadas(linha.variaveis),
        }),
      );
      if (!r.pronto) {
        // Desistimos antes do recolhimento, e `falhou` (não reprocessável):
        // a automação pode ter rodado.
        await gravarResultado(
          admin,
          id,
          { resultado: "falhou", detalhe: "o processamento passou do tempo e foi interrompido", contactId: null },
          claimIso,
        );
        return NextResponse.json({ error: "tempo_esgotado" }, { status: 504 });
      }
      await gravarResultado(admin, id, r.valor, claimIso);
      return NextResponse.json({ ok: true, resultado: r.valor.resultado, detalhe: r.valor.detalhe });
    } catch (e) {
      // Estourou DEPOIS do cadeado: a automação pode ter rodado antes de
      // morrer. `falhou` (não reprocessável), nunca soltar limpo.
      await gravarResultado(
        admin,
        id,
        { resultado: "falhou", detalhe: e instanceof Error ? e.message.slice(0, 500) : "erro desconhecido", contactId: null },
        claimIso,
      );
      return NextResponse.json({ error: "processamento_falhou" }, { status: 500 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
