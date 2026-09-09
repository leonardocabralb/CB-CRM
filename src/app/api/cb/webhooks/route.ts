// ============================================================
// /api/cb/webhooks — os webhooks de ENTRADA da conta (982). Admin+.
//
// GET  — lista, com o total de acionamentos de cada um e a origem pública
//        do CRM (é ela que monta a URL que o operador cola lá fora).
// POST — cria. O SEGREDO volta EM CLARO uma única vez, aqui; depois
//        disso não sai de rota nenhuma, nem mascarado.
// ============================================================

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/automations/admin-client";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { nomeDeVariavel } from "@/lib/webhooks-de-entrada/achatar";
import {
  criarWebhook,
  listarWebhooks,
  origemPublica,
  urlDoWebhook,
} from "@/lib/webhooks-de-entrada/repo";

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const admin = supabaseAdmin();
    const webhooks = await listarWebhooks(admin, ctx.accountId);
    if (!webhooks) {
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }

    // Um `count` por webhook. São poucos por conta, e o `head: true` não
    // traz linha nenhuma — só o cabeçalho com o número.
    const totais = await Promise.all(
      webhooks.map(async (w) => {
        const { count } = await admin
          .from("cb_webhook_eventos")
          .select("id", { count: "exact", head: true })
          .eq("account_id", ctx.accountId)
          .eq("webhook_id", w.id);
        return { id: w.id, total: count ?? 0 };
      })
    );
    const totalPorId = new Map(totais.map((t) => [t.id, t.total]));

    const origem = origemPublica(new URL(request.url).origin);
    return NextResponse.json({
      webhooks: webhooks.map((w) => ({
        ...w,
        total: totalPorId.get(w.id) ?? 0,
        url: origem ? urlDoWebhook(origem, w.token) : null,
      })),
      // ⚠️ AVISO, não recusa: quem copia a URL é o operador, e origem local
      // só significa que a URL mostrada não serve fora desta máquina.
      origemAlcancavel: origem !== null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limite = checkRateLimit(
      `cb:webhooks:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limite.success) return rateLimitResponse(limite);

    const corpo = (await request.json().catch(() => null)) as {
      nome?: unknown;
      sem_segredo?: unknown;
      campo_telefone?: unknown;
      campo_nome?: unknown;
      campo_id?: unknown;
    } | null;

    const nome = typeof corpo?.nome === "string" ? corpo.nome.trim() : "";
    if (!nome) {
      return NextResponse.json({ error: "nome_obrigatorio" }, { status: 400 });
    }
    if (nome.length > 60) {
      return NextResponse.json({ error: "nome_longo" }, { status: 400 });
    }

    // Os campos de mapeamento são guardados JÁ SANEADOS: é assim que eles
    // aparecem no payload achatado, e guardar o cru faria a tela mostrar
    // "telefone-do-cliente" enquanto a busca procura "telefone_do_cliente".
    const campo = (v: unknown): string | null => {
      if (typeof v !== "string") return null;
      const limpo = nomeDeVariavel(v);
      return limpo || null;
    };

    const r = await criarWebhook(supabaseAdmin(), {
      accountId: ctx.accountId,
      nome,
      semSegredo: corpo?.sem_segredo === true,
      campoTelefone: campo(corpo?.campo_telefone),
      campoNome: campo(corpo?.campo_nome),
      campoId: campo(corpo?.campo_id),
      createdBy: ctx.userId,
    });

    if (!r.ok) {
      return NextResponse.json(
        { error: r.erro },
        { status: r.erro === "nome_repetido" ? 409 : 500 }
      );
    }

    const origem = origemPublica(new URL(request.url).origin);
    return NextResponse.json(
      {
        webhook: {
          ...r.webhook,
          total: 0,
          url: origem ? urlDoWebhook(origem, r.webhook.token) : null,
        },
        // Única vez que ele existe em claro fora do banco.
        segredo: r.segredo,
      },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
