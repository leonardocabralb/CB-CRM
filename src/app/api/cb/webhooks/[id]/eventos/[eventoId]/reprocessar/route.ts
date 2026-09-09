// ============================================================
// POST /api/cb/webhooks/{id}/eventos/{eventoId}/reprocessar — Admin+.
//
// Roda de novo o acionamento JÁ GRAVADO, depois que o operador arrumou o
// que faltava (o campo de telefone, a automação, o escopo).
//
// ⚠️ Passa pelo CADEADO, nunca por "ler o estado e então processar": no
// deploy `start-first` há dois processos Node vivos, e dois cliques — duas
// abas, dois administradores, ou um clique enquanto o `after()` do webhook
// ainda roda — mandariam a mensagem ao cliente duas vezes.
//
// ⚠️ E reprocessa a partir das VARIÁVEIS GRAVADAS, nunca de um remonte: o
// payload original não existe em coluna nenhuma, e reconstruí-lo entregaria
// à automação um conjunto menor de variáveis que o da primeira entrega, em
// silêncio.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  comTetoDeProcessamento,
  motivoDaRecusa,
  reivindicarAcionamento,
  TETO_DE_PROCESSAMENTO_MS,
} from "@/lib/webhooks-de-entrada/claim";
import {
  gravarResultado,
  processarAcionamento,
} from "@/lib/webhooks-de-entrada/processar";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; eventoId: string }> }
) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks:reprocessar:${ctx.userId}`,
      RATE_LIMITS.execucao
    );
    if (!limite.success) return rateLimitResponse(limite);

    const { id, eventoId } = await params;
    const admin = supabaseAdmin();

    const { data: webhook, error: erroWebhook } = await admin
      .from("cb_webhooks")
      .select("id, nome, is_active, campo_telefone, campo_nome")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();
    if (erroWebhook) {
      console.error("[cb/webhooks/reprocessar] webhook:", erroWebhook);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if (!webhook) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // ⚠️ Recusar ANTES de reivindicar. Processar com o webhook desligado
    // devolve `ignorado`, que é TERMINAL (não está em
    // `RESULTADOS_REPROCESSAVEIS`): um clique no botão — que segue aceso
    // para `sem_automacao` — queimaria a linha para sempre, e religar o
    // webhook não a traria de volta.
    if (!webhook.is_active) {
      return NextResponse.json({ error: "webhook_desligado" }, { status: 409 });
    }

    const claim = await reivindicarAcionamento(admin, {
      id: eventoId,
      accountId: ctx.accountId,
      webhookId: id,
    });
    if (claim.erro) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if (!claim.linha) {
      // Não peguei. Reler para dizer POR QUE — "espere, está rodando" e
      // "não insista, já rodou" são conselhos diferentes.
      const { data: atual, error: erroRelendo } = await admin
        .from("cb_webhook_eventos")
        .select("resultado, processando_desde")
        .eq("id", eventoId)
        .eq("account_id", ctx.accountId)
        // Mesma cerca do claim: sem ela, um evento de OUTRO webhook devolve
        // "já processado" em vez de "não existe aqui".
        .eq("webhook_id", id)
        .maybeSingle();
      // ⚠️ Erro de banco aqui NÃO pode virar 404: o operador concluiria que
      // o acionamento sumiu do log.
      if (erroRelendo) {
        return NextResponse.json({ error: "db_error" }, { status: 500 });
      }
      const motivo = motivoDaRecusa(atual, Date.now());
      return NextResponse.json(
        { error: motivo },
        { status: motivo === "not_found" ? 404 : 409 }
      );
    }

    const linha = claim.linha as Record<string, unknown>;
    const claimIso = String(linha.processando_desde);
    const variaveis = (linha.variaveis ?? {}) as Record<string, string>;

    // ⚠️ try PRÓPRIO daqui para baixo: com o cadeado na mão, TODA saída
    // precisa carimbar um resultado. Deixar a exceção subir para o catch de
    // fora devolveria o erro e deixaria a linha presa em `recebido` com o
    // cadeado preso, até o recolhimento por idade.
    try {
      const r = await comTetoDeProcessamento(
        processarAcionamento(admin, ctx.accountId, webhook, { variaveis })
      );

      if (!r.pronto) {
        await gravarResultado(
          admin,
          eventoId,
          {
            resultado: "falhou",
            detalhe: `o processamento passou de ${Math.round(TETO_DE_PROCESSAMENTO_MS / 60000)} minutos e foi interrompido`,
            contactId: null,
          },
          claimIso
        );
        return NextResponse.json({ error: "tempo_esgotado" }, { status: 504 });
      }

      await gravarResultado(admin, eventoId, r.valor, claimIso);
      return NextResponse.json({ ok: true, resultado: r.valor.resultado });
    } catch (err) {
      // `falhou` (não reprocessável) em vez de soltar limpo: a automação
      // pode ter enviado antes de morrer, e reprocessar mandaria de novo.
      console.error("[cb/webhooks/reprocessar] processamento:", err);
      await gravarResultado(
        admin,
        eventoId,
        {
          resultado: "falhou",
          detalhe: "erro inesperado no reprocessamento",
          contactId: null,
        },
        claimIso
      );
      return NextResponse.json({ error: "falhou" }, { status: 500 });
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
