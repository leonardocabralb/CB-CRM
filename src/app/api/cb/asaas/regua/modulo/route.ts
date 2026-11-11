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

    // Os envios dos últimos 7 dias, em MENSAGENS: a trava é uma linha por
    // PARCELA, e um envio fecha todas as do grupo — conta-se o log (ou,
    // sem ele, cliente + tipo + dia). Leitura que falha ou passa do teto
    // vira `null` (a tela cala), nunca 0.
    const desde = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const enviados = RESULTADOS_QUE_CONTAM_COMO_ENVIO;
    let envios7d: { lembretes: number; cobrancas: number; falhas: number } | null = null;
    {
      const vistos = { lembretes: new Set<string>(), cobrancas: new Set<string>(), falhas: new Set<string>() };
      let completo = false;
      for (let pagina = 0; pagina < 10; pagina++) {
        const { data, error } = await admin
          .from("cb_asaas_regua_envios")
          .select("asaas_customer_id, tipo, resultado, criado_em, automation_log_id")
          .eq("account_id", ctx.accountId)
          .gte("criado_em", desde)
          .order("id")
          .range(pagina * 1000, pagina * 1000 + 999);
        if (error) break;
        const linhas = (data ?? []) as { asaas_customer_id: string; tipo: string; resultado: string; criado_em: string; automation_log_id: string | null }[];
        for (const l of linhas) {
          const chave = l.automation_log_id ?? `${l.asaas_customer_id}|${l.tipo}|${l.criado_em.slice(0, 10)}`;
          if (l.resultado === "falhou") vistos.falhas.add(chave);
          else if (enviados.has(l.resultado)) (l.tipo === "vence_hoje" ? vistos.lembretes : vistos.cobrancas).add(chave);
        }
        if (linhas.length < 1000) {
          completo = true;
          break;
        }
      }
      if (completo) envios7d = { lembretes: vistos.lembretes.size, cobrancas: vistos.cobrancas.size, falhas: vistos.falhas.size };
    }

    // A etiqueta do "Pedir ligação" sai do que está gravado nas cobranças.
    const estado = derivarEstado(automacoes);
    let ligacoesPendentes: number | null = null;
    if (estado.ligacao.tipo === "igual") {
      // A etiqueta sai de passos gravados (o PATCH não confere o dono dela):
      // só conta se for DESTA conta.
      const tagId = estado.ligacao.config.tagId;
      const { data: daConta } = await admin.from("tags").select("id").eq("id", tagId).eq("account_id", ctx.accountId).maybeSingle();
      if (daConta) {
        const { count, error } = await admin.from("contact_tags").select("contact_id", { count: "exact", head: true }).eq("tag_id", tagId);
        ligacoesPendentes = error || count === null ? null : count;
      }
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
      envios7d,
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
