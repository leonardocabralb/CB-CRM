import { NextResponse } from "next/server";

import { GATILHOS_DA_REGUA, HORA_PADRAO_COBRANCA, HORA_PADRAO_LEMBRETE, lerAutomacaoDaRegua } from "@/lib/asaas/regua";
import {
  ASSINATURA_DA_NOITE,
  HORA_PADRAO_LEMBRETE_DA_NOITE,
  MARCOS_PADRAO,
  NOME_DO_LEMBRETE_DA_NOITE,
  NOME_DO_LEMBRETE_DO_DIA,
  nomeDaCobranca,
  TEXTO_DA_COBRANCA,
  TEXTO_DO_LEMBRETE,
  TEXTO_DO_LEMBRETE_DA_NOITE,
} from "@/lib/asaas/textos-da-regua";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { insertSteps } from "@/lib/automations/steps-tree";
import { normalizarAssinatura } from "@/lib/assinatura/assinatura";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * POST /api/cb/asaas/regua  (admin+) — "Criar régua padrão" (§3.6): cria,
 * DESLIGADAS, as automações que ainda faltam — "Cobrança · 1 dia", "· 5
 * dias", "· 15 dias", "· 30 dias" (gatilho `asaas_cobranca_vencida`; o de 15
 * entrou em 10/11/2026, pedido do operador: entre 5 e 30 o cliente de uma
 * parcela só ficava 25 dias sem contato) e "Lembrete · vence
 * hoje" (`asaas_cobranca_vence_hoje`) —, cada uma com um passo de mensagem
 * editável, pulando o marco que já existe. O operador troca o texto no
 * editor de sempre e liga uma a uma; mais marcos são automações novas do
 * mesmo gatilho.
 *
 * ⚠️ A conexão do passo (D19, obrigatória para ligar) nasce com a conexão
 * PADRÃO da conta quando ela é por QR Code (a Meta fica fora da v1: texto
 * livre fora das 24 h não sai); sem uma, o passo nasce sem conexão e a
 * ativação recusa até alguém escolher — nunca o padrão em silêncio.
 *
 * Os dois textos se APRESENTAM ("Aqui é do…") porque, para as fichas criadas
 * pela D2, esta é a PRIMEIRA mensagem que o cliente recebe deste número, e a
 * assinatura da conta pode estar desligada; e dizem "se já pagou,
 * desconsidere" porque o boleto pago no caixa fica PENDING até compensar.
 *
 * Com corpo `{ dias, canal_id?, assinatura?, somente_dias_uteis? }` (a etapa
 * nova da tela "Cobrança automática", 1135) cria SÓ a cobrança daquele marco,
 * desligada, com o texto padrão, a conexão e a assinatura de "Quem manda" e a
 * regra de dias úteis salva — 409 se o marco já existe. A conexão tem de ser
 * da conta (senão 400); o resto da conferência (conectada, por QR Code) é a
 * da ativação, como no construtor. Sem `somente_dias_uteis`, só dia útil.
 */

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");
    const limit = checkRateLimit(`cb:asaas:regua:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const pedido = (await request.json().catch(() => null)) as { dias?: unknown; canal_id?: unknown; assinatura?: unknown; somente_dias_uteis?: unknown } | null;
    const umaEtapa = pedido !== null && pedido.dias !== undefined;
    const diasPedidos = Number(pedido?.dias);
    if (umaEtapa && (!Number.isInteger(diasPedidos) || diasPedidos < 1 || diasPedidos > 365)) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const admin = supabaseAdmin();
    const { data: existentes, error } = await admin
      .from("automations")
      .select("id, trigger_type, trigger_config")
      .eq("account_id", ctx.accountId)
      .in("trigger_type", [...GATILHOS_DA_REGUA]);
    if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
    const marcosExistentes = new Set<number>();
    // os turnos de lembrete que já existem (0 = dia, 1 = noite — 1133)
    const turnosExistentes = new Set<number>();
    for (const a of (existentes ?? []) as { trigger_type: string; trigger_config: Record<string, unknown> | null }[]) {
      if (a.trigger_type === "asaas_cobranca_vence_hoje") turnosExistentes.add(lerAutomacaoDaRegua({ id: "", name: "", trigger_type: a.trigger_type, trigger_config: a.trigger_config })?.marco ?? 0);
      else marcosExistentes.add(Number(a.trigger_config?.dias_de_atraso));
    }

    // A conexão padrão por QR Code, se houver — nunca a Meta (texto livre
    // fora das 24 h não sai) e nunca em silêncio: sem ela o passo nasce sem
    // conexão e a ativação recusa até alguém escolher.
    const { data: canais } = await admin
      .from("cb_channels")
      .select("id, kind, is_default")
      .eq("account_id", ctx.accountId)
      .eq("status", "connected")
      .eq("kind", "evolution")
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1);
    let canalId = (canais?.[0]?.id as string | undefined) ?? null;
    // A tela "Cobrança automática" manda o número e quem assina de "Quem
    // manda" também na régua padrão (1135): sem isso as etapas novas nasciam
    // no número padrão, sem assinatura.
    const assinaturaPedida = pedido && "assinatura" in pedido ? normalizarAssinatura(pedido.assinatura) : null;
    // A regra "Só em dia útil" que a tela tem salva vale também para a etapa
    // que nasce — senão a nova adiava fim de semana com a régua em dias
    // corridos (Codex, PR #499).
    const somenteDiasUteis = pedido?.somente_dias_uteis === false ? false : true;
    if (typeof pedido?.canal_id === "string") {
      const { data: daConta, error: erroDoCanal } = await admin.from("cb_channels").select("id").eq("id", pedido.canal_id).eq("account_id", ctx.accountId).maybeSingle();
      if (erroDoCanal) return NextResponse.json({ error: "db_error" }, { status: 500 });
      if (!daConta) return NextResponse.json({ error: "canal_invalido" }, { status: 400 });
      canalId = daConta.id as string;
    }
    const passo = (texto: string) => ({ step_type: "send_message", step_config: canalId ? { text: texto, channel_id: canalId } : { text: texto } });

    const criadas: string[] = [];
    const ids: string[] = [];
    const criar = async (nome: string, tipo: string, config: Record<string, unknown>, texto: string, assinatura: string | null = null) => {
      const { data: automacao, error: erroInsert } = await admin
        .from("automations")
        .insert({
          user_id: ctx.userId,
          account_id: ctx.accountId,
          name: nome,
          description: null,
          trigger_type: tipo,
          trigger_config: config,
          channel_ids: null,
          stage_ids: null,
          is_active: false,
          assinatura_personalizada: assinatura,
        })
        .select("id")
        .single();
      if (erroInsert || !automacao) throw new Error(erroInsert?.message ?? "insert falhou");
      const erroPassos = await insertSteps(automacao.id as string, [passo(texto)]);
      if (erroPassos) {
        // Sem o passo a automação ficaria de pé e a próxima tentativa a leria
        // como "esse marco já existe" — irreparável pelo botão (Codex, 2ª
        // rodada do PR #206). Apaga a linha recém-criada e falha.
        await admin.from("automations").delete().eq("id", automacao.id as string).eq("account_id", ctx.accountId);
        throw new Error(erroPassos);
      }
      criadas.push(nome);
      return automacao.id as string;
    };

    if (umaEtapa) {
      if (marcosExistentes.has(diasPedidos)) return NextResponse.json({ error: "ja_existe" }, { status: 409 });
      const id = await criar(nomeDaCobranca(diasPedidos), "asaas_cobranca_vencida", { dias_de_atraso: diasPedidos, hora_envio: HORA_PADRAO_COBRANCA, somente_dias_uteis: somenteDiasUteis }, TEXTO_DA_COBRANCA, assinaturaPedida);
      return NextResponse.json({ ok: true, criadas, id, ids: [id] });
    }

    for (const marco of MARCOS_PADRAO) {
      if (marcosExistentes.has(marco)) continue;
      ids.push(await criar(nomeDaCobranca(marco), "asaas_cobranca_vencida", { dias_de_atraso: marco, hora_envio: HORA_PADRAO_COBRANCA, somente_dias_uteis: somenteDiasUteis }, TEXTO_DA_COBRANCA, assinaturaPedida));
    }
    if (!turnosExistentes.has(0)) {
      ids.push(await criar(NOME_DO_LEMBRETE_DO_DIA, "asaas_cobranca_vence_hoje", { hora_envio: HORA_PADRAO_LEMBRETE, somente_dias_uteis: somenteDiasUteis }, TEXTO_DO_LEMBRETE, assinaturaPedida));
    }
    if (!turnosExistentes.has(1)) {
      ids.push(await criar(NOME_DO_LEMBRETE_DA_NOITE, "asaas_cobranca_vence_hoje", { hora_envio: HORA_PADRAO_LEMBRETE_DA_NOITE, somente_dias_uteis: somenteDiasUteis }, TEXTO_DO_LEMBRETE_DA_NOITE, ASSINATURA_DA_NOITE));
    }
    return NextResponse.json({ ok: true, criadas, ids, semConexao: canalId === null });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/regua] criar régua padrão falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
