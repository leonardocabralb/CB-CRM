import { NextResponse } from "next/server";

import { derivarEstado, nomeDoEscritorio, type AutomacaoDoModulo } from "@/lib/asaas/modulo-da-cobranca";
import { GATILHOS_DA_REGUA, RESULTADOS_QUE_CONTAM_COMO_ENVIO } from "@/lib/asaas/regua";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { loadStepsTree } from "@/lib/automations/steps-tree";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * GET /api/cb/asaas/regua/modulo  (admin+) — o que a tela "Cobrança
 * automática" (1135) precisa num pedido só:
 *
 * - `config`: o interruptor, o intervalo, o nome do escritório (o do módulo
 *   e o que vale sem ele) e o aviso de inadimplência;
 * - `automacoes`: as automações da régua com os PASSOS — a tela deriva o
 *   estado delas (`derivarEstado`) e salva por `PATCH /api/automations/[id]`,
 *   a mesma rota (e a mesma validação) do construtor;
 * - `envios7d`: o que a varredura fez nos últimos 7 dias;
 * - `ligacoesPendentes`: quantas fichas estão com a etiqueta do "Pedir
 *   ligação" agora (esperando alguém ligar).
 *
 * ⚠️ Os números que a tela mostra como afirmação ("84 lembretes") vêm
 * `null` quando a leitura falha — nunca 0. A config e as automações, não:
 * sem elas a tela não tem o que mostrar, e a rota responde 500.
 */
export async function GET() {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:regua-modulo:${ctx.userId}`, RATE_LIMITS.execucao);
    if (!limit.success) return rateLimitResponse(limit);
    const admin = supabaseAdmin();

    const [{ data: config, error: erroDaConfig }, { data: conta, error: erroDaConta }, { data: linhas, error: erroDasAutomacoes }] = await Promise.all([
      admin
        .from("cb_asaas_config")
        .select("regua_ativa, regua_ativada_em, regua_intervalo_dias, regua_escritorio_nome, aviso_inadimplencia_ativo")
        .eq("account_id", ctx.accountId)
        .maybeSingle(),
      admin.from("accounts").select("name, assinatura_nome_automatica, assinatura_ativa").eq("id", ctx.accountId).maybeSingle(),
      admin
        .from("automations")
        .select("id, name, trigger_type, trigger_config, is_active, assinatura_personalizada")
        .eq("account_id", ctx.accountId)
        .in("trigger_type", [...GATILHOS_DA_REGUA])
        .order("created_at", { ascending: true }),
    ]);
    if (erroDaConfig || erroDaConta || erroDasAutomacoes) return NextResponse.json({ error: "db_error" }, { status: 500 });
    if (!config) return NextResponse.json({ conectado: false });

    const automacoes: AutomacaoDoModulo[] = [];
    for (const a of (linhas ?? []) as Omit<AutomacaoDoModulo, "steps">[]) {
      automacoes.push({ ...a, trigger_config: (a.trigger_config ?? null) as Record<string, unknown> | null, steps: await loadStepsTree(a.id) });
    }

    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const contar = async (tipo: "vence_hoje" | "atraso" | null, resultados: string[]): Promise<number | null> => {
      let q = admin.from("cb_asaas_regua_envios").select("id", { count: "exact", head: true }).eq("account_id", ctx.accountId).gte("criado_em", desde).in("resultado", resultados);
      if (tipo) q = q.eq("tipo", tipo);
      const { count, error } = await q;
      return error || count === null ? null : count;
    };
    const enviados = [...RESULTADOS_QUE_CONTAM_COMO_ENVIO];
    const [lembretes, cobrancas, falhas] = await Promise.all([contar("vence_hoje", enviados), contar("atraso", enviados), contar(null, ["falhou"])]);

    // A etiqueta do "Pedir ligação" sai do que está gravado nas cobranças.
    const estado = derivarEstado(automacoes);
    let ligacoesPendentes: number | null = null;
    if (estado.ligacao.tipo === "igual") {
      const { count, error } = await admin.from("contact_tags").select("contact_id", { count: "exact", head: true }).eq("tag_id", estado.ligacao.config.tagId);
      ligacoesPendentes = error || count === null ? null : count;
    }

    const escritorioPadrao = nomeDoEscritorio(null, conta?.assinatura_nome_automatica as string | null, conta?.name as string | null);
    return NextResponse.json({
      conectado: true,
      config: {
        ativa: config.regua_ativa === true,
        ativadaEm: (config.regua_ativada_em as string | null) ?? null,
        intervaloDias: typeof config.regua_intervalo_dias === "number" ? config.regua_intervalo_dias : 3,
        escritorioNome: (config.regua_escritorio_nome as string | null) ?? null,
        escritorioPadrao,
        avisoAtivo: config.aviso_inadimplencia_ativo !== false,
        assinaturaAtiva: conta?.assinatura_ativa !== false,
      },
      automacoes,
      envios7d: lembretes === null || cobrancas === null || falhas === null ? null : { lembretes, cobrancas, falhas },
      ligacoesPendentes,
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/regua/modulo] leitura falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
