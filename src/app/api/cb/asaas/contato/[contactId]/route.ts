import { NextResponse } from "next/server";

import { cicloCompleto, leituraFresca, lerClientesDoContato, lerCobrancasDosClientes, lerConfigDoEspelho, lerEnviosDoContato } from "@/lib/asaas/espelho";
import { diaNoFuso, FUSO_PADRAO } from "@/lib/agenda/fuso";
import { proximaEtapaPrevista } from "@/lib/asaas/proxima-etapa";
import { GATILHOS_DA_REGUA, lerAutomacaoDaRegua, RESULTADOS_QUE_CONTAM_COMO_ENVIO, type AutomacaoDaRegua } from "@/lib/asaas/regua";
import type { ParcelaDoEspelho } from "@/lib/asaas/inadimplencia";
import { supabaseAdmin } from "@/lib/automations/admin-client";
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/cb/asaas/contato/[contactId] — a aba Cobranças de UM contato.
 *
 * `{ conectado, leituraFresca, atualizadoEm, clientes: [{ id, asaasId, nome,
 * origem, notificacoesDesligadas }], parcelas: parcela[] }` — os clientes do
 * Asaas ligados ao contato e TODAS as parcelas deles que o espelho guarda
 * (as devidas, as que regularizaram, as estornadas, a que vence hoje). Quem
 * reparte é o navegador (`separarParcelas`), com o relógio da tela.
 *
 * Qualquer membro lê (D4). Sem CPF — ele só sai mascarado, e só para o
 * administrador, pelas listas do cartão. Contato de outra conta → a
 * consulta simplesmente não acha cliente ligado (`account_id` na cerca).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const ctx = await getCurrentAccount();
    const limit = checkRateLimit(`cb:asaas:contato:${ctx.userId}`, RATE_LIMITS.execucao);
    if (!limit.success) return rateLimitResponse(limit);

    const { contactId } = await params;
    if (!UUID.test(contactId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const admin = supabaseAdmin();
    const config = await lerConfigDoEspelho(admin, ctx.accountId);
    if (!config) return NextResponse.json({ conectado: false, leituraFresca: false, atualizadoEm: null, cicloCompleto: false, clientes: [], parcelas: [], reguaAtiva: false, reguaComAutomacoes: false, envios: [] });

    // Paginado (o catch abaixo responde 500 acima do teto): um contato com
    // mais clientes que uma página perderia clientes E as cobranças deles.
    const ligados = await lerClientesDoContato(admin, ctx.accountId, contactId);
    const clientes = ligados.map((c) => ({
      id: c.id,
      asaasId: c.asaas_customer_id,
      nome: c.nome ?? "",
      origem: c.vinculo_origem,
      notificacoesDesligadas: c.notificacoes_desligadas,
      reguaDesligada: c.regua_desligada,
    }));

    // Paginada, e acima do teto ESTOURA (o catch abaixo responde 500):
    // uma lista parcial seria lida como "as outras não existem".
    const parcelas: ParcelaDoEspelho[] = await lerCobrancasDosClientes(
      admin,
      ctx.accountId,
      clientes.map((c) => c.asaasId),
    );

    // A régua (998): o histórico deste contato e o estado do interruptor —
    // a aba diz "Cobrança automática desligada" quando há automação ligada
    // e o interruptor não (D20).
    const [envios, { data: daRegua, error: erroDaRegua }] = await Promise.all([
      lerEnviosDoContato(admin, ctx.accountId, contactId),
      admin.from("automations").select("id, name, trigger_type, trigger_config, is_active").eq("account_id", ctx.accountId).in("trigger_type", [...GATILHOS_DA_REGUA]),
    ]);
    if (erroDaRegua) throw new Error(`automações da régua: ${erroDaRegua.message}`);
    const automacoesDaRegua = (daRegua ?? []) as { id: string; name: string; trigger_type: string; trigger_config: unknown; is_active: boolean }[];
    const ligadas = automacoesDaRegua.filter((a) => a.is_active);

    // A PRÓXIMA etapa prevista (1135) — estimativa, só com a régua ligada.
    const agora = new Date();
    let proxima = null;
    if (config.regua_ativa === true && ligadas.length > 0) {
      const etapasLigadas = ligadas.map((a) => lerAutomacaoDaRegua(a)).filter((a): a is AutomacaoDaRegua => a !== null);
      const ultimaCobranca = envios.find((e) => e.tipo === "atraso" && RESULTADOS_QUE_CONTAM_COMO_ENVIO.has(e.resultado));
      proxima = proximaEtapaPrevista({
        parcelas,
        clientesDesligados: new Set(clientes.filter((c) => c.reguaDesligada).map((c) => c.asaasId)),
        etapasLigadas,
        travas: envios.map((e) => ({ tipo: e.tipo, marco: e.marco, vencimento: e.vencimento, resultado: e.resultado, criadoEm: e.criadoEm })),
        reguaAtivadaEm: config.regua_ativada_em ?? null,
        intervaloDias: typeof config.regua_intervalo_dias === "number" ? config.regua_intervalo_dias : 3,
        hoje: diaNoFuso(agora, FUSO_PADRAO),
        agora,
        fuso: FUSO_PADRAO,
        ultimaCobrancaDia: ultimaCobranca ? diaNoFuso(new Date(ultimaCobranca.criadoEm), FUSO_PADRAO) : null,
      });
    }

    // A LIGAÇÃO PEDIDA (1135): a etiqueta do "Pedir ligação" das cobranças
    // (a que a condição pergunta E o passo põe) está nesta ficha agora?
    // Leitura ACESSÓRIA: falhou, a caixa some (`null` não afirma nada) e a aba
    // segue com as parcelas — nunca 500 por causa dela. Só com cliente do
    // Asaas ligado ao contato (o que prova que a ficha é desta conta).
    let ligacao: { etiqueta: string; desde: string } | null = null;
    const idsDaRegua = automacoesDaRegua.filter((a) => a.trigger_type === "asaas_cobranca_vencida").map((a) => a.id);
    if (idsDaRegua.length > 0 && clientes.length > 0) {
      const { data: passos, error: erroDosPassos } = await admin.from("automation_steps").select("step_type, step_config").in("automation_id", idsDaRegua).in("step_type", ["condition", "add_tag"]);
      if (erroDosPassos) console.error("[asaas/contato] passos da régua:", erroDosPassos.message);
      const perguntadas = new Set<string>();
      const postas = new Set<string>();
      for (const p of (passos ?? []) as { step_type: string; step_config: Record<string, unknown> | null }[]) {
        const cfg = p.step_config ?? {};
        if (p.step_type === "condition" && cfg.subject === "tag_presence" && typeof cfg.operand === "string") perguntadas.add(cfg.operand);
        if (p.step_type === "add_tag" && typeof cfg.tag_id === "string") postas.add(cfg.tag_id);
      }
      const daLigacao = [...postas].filter((id) => perguntadas.has(id));
      if (!erroDosPassos && daLigacao.length > 0) {
        // `tags!inner` + a conta: etiqueta de outra conta gravada num passo não vale.
        const { data: naFicha, error: erroDaFicha } = await admin.from("contact_tags").select("tag_id, created_at, tags!inner(name, account_id)").eq("contact_id", contactId).in("tag_id", daLigacao).eq("tags.account_id", ctx.accountId).order("created_at", { ascending: true }).limit(1);
        if (erroDaFicha) console.error("[asaas/contato] etiqueta da ligação:", erroDaFicha.message);
        const linha = (naFicha ?? [])[0] as { created_at: string; tags: { name: string } | { name: string }[] | null } | undefined;
        if (linha) {
          const tag = Array.isArray(linha.tags) ? linha.tags[0] : linha.tags;
          ligacao = { etiqueta: tag?.name ?? "", desde: linha.created_at };
        }
      }
    }

    return NextResponse.json({
      conectado: true,
      leituraFresca: leituraFresca(config, new Date()),
      atualizadoEm: config.vencidas_listadas_em,
      // Ver `cicloCompleto`: só com o ciclo da listagem atual terminado
      // "nenhum cliente ligado" é resposta, e não lacuna do vínculo.
      cicloCompleto: cicloCompleto(config),
      clientes,
      parcelas,
      reguaAtiva: config.regua_ativa === true,
      reguaComAutomacoes: ligadas.length > 0,
      envios,
      proxima,
      ligacao,
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      console.error("[asaas/contato] leitura falhou:", err.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
