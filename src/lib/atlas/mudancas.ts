import type { SupabaseClient } from "@supabase/supabase-js";

import { dispararAutomacoes, type DispatchInput, type ResultadoDoDisparo } from "@/lib/automations/engine";
import type { DealStatus } from "@/types";

import { ambienteDoAtlas, noAmbiente } from "./enderecos";
import {
  cardDoEvento,
  casaSituacao,
  GATILHO_DO_ATLAS,
  lerConfigDoGatilho,
  resultadoDaMudanca,
  variaveisDaMudanca,
  type CardDoContato,
  type ResultadoDaMudanca,
  type SaidaDaAutomacao,
} from "./gatilho";
import { situacaoComparavel } from "./leitura";

/**
 * O DISPARO do gatilho "Situação mudou no Atlas" (1073, Fase 4 de
 * docs/PLANO-integracao-atlas.md) — o I/O. As regras puras estão em
 * `gatilho.ts`; quem ENFILEIRA é a leitura (`situacoes.ts`, na decisão
 * `mudou`).
 *
 * Roda DEPOIS do fechamento do ciclo de leitura de cada conta (o cadeado da
 * leitura já solto), no `after()` do cron e no "Ler situações agora", com
 * reivindicação PRÓPRIA de cada mudança (`pendente → processando`, `UPDATE …
 * RETURNING` cercado pelo estado e pelo número de tentativas). Por mudança:
 *
 * 1. Relê o VÍNCULO (conta, ambiente, escritório da conexão, cliente). Sumiu,
 *    ficha apagada, ou a situação já mudou de novo → `superada`. A escrita
 *    do vínculo ainda não chegou (data guardada nula ou anterior à da
 *    mudança E a situação ainda é a ANTERIOR da mudança) → volta a
 *    `pendente` SEM gastar tentativa: a página relida a grava. Decide o DADO,
 *    nunca o relógio (o operador recusou trava de idade): a espera acaba
 *    quando o vínculo recebe a escrita (dispara) ou outra (`superada`) — o
 *    vínculo regravado com outra situação sem esta data (mudança sem data,
 *    o passo "Criar cliente") sai `superada` na hora. A espera não trava a
 *    fila: a seleção põe as nunca tentadas primeiro (`processando_desde`).
 * 2. As automações ATIVAS do gatilho que casam a situação nova
 *    (`casaSituacao`). Nenhuma → `sem_automacao`.
 * 3. ⚠️⚠️ ANTES de disparar qualquer automação, UMA leitura dos cards do
 *    contato (a união dos funis das automações que casaram, em qualquer
 *    status) e UMA da conversa. Qualquer falha aqui → `pendente` (teto de
 *    tentativas → `falhou`). Ler por automação, dentro do laço, deixava a
 *    falha da segunda devolver a mudança à fila com a primeira JÁ rodada — e
 *    a volta a rodaria de novo (CLAUDE.md 8e).
 * 4. Por automação, em memória: nenhum card nos funis dela → `sem_card` (o
 *    ex-cliente cujo card está noutro funil NUNCA é arrastado — decisão do
 *    operador); mais de um → `card_ambiguo`; um → `dispararAutomacoes` com
 *    `automation_id` (só ela casa: `triggerMatches`), o card (`deal_id` +
 *    `deal_status_fixado`, conferido pela RPC ao mover) e a conversa.
 * 5. O resultado (`resultadoDaMudanca`), gravado com a cerca de posse. Só
 *    quando NADA rodou e o disparo foi recusado antes da primeira automação
 *    a mudança volta a `pendente`; se alguma rodou, nunca volta.
 *
 * `processando` há mais de `RECOLHER_MUDANCA_MS` (o processo morreu no
 * meio) vira `falhou`, NUNCA volta à fila: pode ter rodado.
 */

/** Mudanças reivindicadas por conta e por chamada (a leitura roda a cada ~15 min). */
export const MUDANCAS_POR_VEZ = 20;
/** Tentativas que falharam ANTES de disparar (leitura do banco); depois, `falhou`. */
export const TETO_DE_TENTATIVAS = 3;
/** `processando` sem dono há mais que isto é recolhido como `falhou` (nunca repete). */
export const RECOLHER_MUDANCA_MS = 10 * 60_000;
/**
 * A janela PRÓPRIA do disparo, contada de quando ele começa: quem chama passa
 * o prazo da leitura, que uma listagem longa (10 páginas, pausa de 3 s,
 * Atlas lento) gasta inteiro — sem a janela, nada seria reivindicado e o
 * card esperaria um ciclo de leitura curta.
 */
export const JANELA_MINIMA_DO_DISPARO_MS = 15_000;
const COLUNAS_DA_MUDANCA = "id, atlas_client_id, situacao_anterior, situacao_nova, situacao_desde, tentativas";

interface MudancaNaFila {
  id: string;
  atlas_client_id: string;
  situacao_anterior: string;
  situacao_nova: string;
  situacao_desde: string;
  tentativas: number;
}

interface AutomacaoDoGatilho {
  id: string;
  name: string;
  trigger_config: unknown;
}

export interface ContagemDoDisparo {
  recolhidas: number;
  reivindicadas: number;
  /** Voltaram a `pendente` (nada rodou). */
  devolvidas: number;
  porResultado: Partial<Record<ResultadoDaMudanca, number>>;
}

export type ResultadoDoDisparoDasMudancas = { ok: true; contagem: ContagemDoDisparo } | { ok: false; codigo: "nao_conectado" | "db_error"; contagem?: ContagemDoDisparo };

export interface OpcoesDoDisparo {
  /**
   * Instante (epoch ms, relógio REAL) depois do qual nenhuma mudança nova é
   * reivindicada — nunca antes de `JANELA_MINIMA_DO_DISPARO_MS` a partir do
   * início do disparo.
   */
  prazoMs: number;
  ambiente?: string | null;
  /** O motor (os testes passam um falso). */
  disparar?: (input: DispatchInput) => Promise<ResultadoDoDisparo>;
}

const instante = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** Uma leitura ANTES do primeiro disparo falhou: nada rodou. */
class FalhaDeLeitura extends Error {}

export async function dispararMudancas(admin: SupabaseClient, accountId: string, opcoes: OpcoesDoDisparo): Promise<ResultadoDoDisparoDasMudancas> {
  const ambiente = opcoes.ambiente === undefined ? ambienteDoAtlas() : opcoes.ambiente;
  const disparar = opcoes.disparar ?? dispararAutomacoes;
  const prazoMs = Math.max(opcoes.prazoMs, Date.now() + JANELA_MINIMA_DO_DISPARO_MS);
  const contagem: ContagemDoDisparo = { recolhidas: 0, reivindicadas: 0, devolvidas: 0, porResultado: {} };
  const fila = () => admin.from("cb_atlas_mudancas");

  // A conexão DESTE ambiente: o escritório dela recorta o vínculo (o de outro escritório é invisível).
  const { data: conexao, error: erroConexao } = await noAmbiente(admin.from("cb_atlas_config").select("atlas_tenant_id").eq("account_id", accountId), ambiente).maybeSingle();
  if (erroConexao) {
    console.error(`[atlas] disparo das mudanças da conta ${accountId}: a conexão não pôde ser lida:`, erroConexao.message);
    return { ok: false, codigo: "db_error" };
  }
  if (!conexao) return { ok: false, codigo: "nao_conectado" };
  const tenantId = String((conexao as { atlas_tenant_id: string }).atlas_tenant_id);

  // 1) Recolher: o processo morreu no meio — pode ter rodado, então NUNCA volta à fila.
  const agora = new Date();
  const { data: recolhidas, error: erroRecolher } = await noAmbiente(
    fila()
      .update({
        estado: "feito",
        resultado: "falhou",
        detalhe: "interrompida no meio do disparo — confira o histórico das automações; nada foi repetido",
        processado_em: agora.toISOString(),
      })
      .eq("account_id", accountId),
    ambiente,
  )
    .eq("estado", "processando")
    .lt("processando_desde", new Date(agora.getTime() - RECOLHER_MUDANCA_MS).toISOString())
    .select("id");
  if (erroRecolher) {
    console.error(`[atlas] disparo das mudanças da conta ${accountId}: o recolhimento falhou:`, erroRecolher.message);
    return { ok: false, codigo: "db_error", contagem };
  }
  contagem.recolhidas = (recolhidas ?? []).length;

  // 2) As pendentes: as nunca tentadas primeiro, depois as tentadas há mais
  //    tempo (`processando_desde` fica na devolvida como "última tentativa").
  //    Por `created_at` só, 20 esperando a escrita do vínculo travariam a fila.
  const { data: pendentes, error: erroPendentes } = await noAmbiente(fila().select(COLUNAS_DA_MUDANCA).eq("account_id", accountId), ambiente)
    .eq("estado", "pendente")
    .order("processando_desde", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: true })
    .limit(MUDANCAS_POR_VEZ);
  if (erroPendentes) {
    console.error(`[atlas] disparo das mudanças da conta ${accountId}: a fila não pôde ser lida:`, erroPendentes.message);
    return { ok: false, codigo: "db_error", contagem };
  }
  const lista = (pendentes ?? []) as MudancaNaFila[];
  if (lista.length === 0) return { ok: true, contagem };

  // As automações ligadas do gatilho, UMA leitura para todas as mudanças.
  const { data: automacoes, error: erroAutomacoes } = await admin
    .from("automations")
    .select("id, name, trigger_config")
    .eq("account_id", accountId)
    .eq("trigger_type", GATILHO_DO_ATLAS)
    .eq("is_active", true);
  if (erroAutomacoes) {
    console.error(`[atlas] disparo das mudanças da conta ${accountId}: as automações não puderam ser lidas:`, erroAutomacoes.message);
    return { ok: false, codigo: "db_error", contagem };
  }
  const ligadas = (automacoes ?? []) as AutomacaoDoGatilho[];

  for (const m of lista) {
    if (Date.now() >= prazoMs) break;
    // 3) Reivindicar, cercado pelo estado E pelas tentativas (o contador é a cerca contra a corrida).
    const posse = new Date().toISOString();
    const { data: tomada, error: erroPosse } = await fila()
      .update({ estado: "processando", processando_desde: posse, tentativas: m.tentativas + 1 })
      .eq("id", m.id)
      .eq("account_id", accountId)
      .eq("estado", "pendente")
      .eq("tentativas", m.tentativas)
      .select("id");
    if (erroPosse) {
      console.error(`[atlas] mudança ${m.id}: a reivindicação falhou:`, erroPosse.message);
      continue;
    }
    if (!tomada || tomada.length === 0) continue;
    contagem.reivindicadas++;

    /** A escrita final, com a cerca de posse. */
    const fechar = async (patch: Record<string, unknown>) => {
      const { data, error } = await fila().update(patch).eq("id", m.id).eq("account_id", accountId).eq("estado", "processando").eq("processando_desde", posse).select("id");
      if (error) console.error(`[atlas] mudança ${m.id}: o resultado não pôde ser gravado:`, error.message);
      else if (!data || data.length === 0) console.warn(`[atlas] mudança ${m.id}: a posse foi perdida antes de gravar o resultado`);
    };
    const concluir = async (resultado: ResultadoDaMudanca, detalhe: string) => {
      contagem.porResultado[resultado] = (contagem.porResultado[resultado] ?? 0) + 1;
      await fechar({ estado: "feito", resultado, detalhe, processado_em: new Date().toISOString() });
    };
    /**
     * Nada rodou: volta à fila. `gastou` = a tentativa conta (teto → `falhou`).
     * `processando_desde` FICA (a última tentativa): é o rodízio da seleção.
     */
    const devolver = async (motivo: string, gastou: boolean) => {
      if (gastou && m.tentativas + 1 >= TETO_DE_TENTATIVAS) {
        await concluir("falhou", `${motivo} — ${TETO_DE_TENTATIVAS} tentativas, nada foi disparado`);
        return;
      }
      contagem.devolvidas++;
      await fechar({ estado: "pendente", ...(gastou ? {} : { tentativas: m.tentativas }), detalhe: motivo });
    };

    let disparou = false;
    try {
      // 4) O vínculo relido (conta, ambiente, escritório, cliente).
      const { data: vinculo, error: erroVinculo } = await noAmbiente(
        admin.from("cb_atlas_clientes").select("contact_id, situacao, situacao_desde, app_url").eq("account_id", accountId),
        ambiente,
      )
        .eq("atlas_tenant_id", tenantId)
        .eq("atlas_client_id", m.atlas_client_id)
        .maybeSingle();
      if (erroVinculo) throw new FalhaDeLeitura(`o vínculo não pôde ser lido: ${erroVinculo.message}`);
      const v = vinculo as { contact_id: string | null; situacao: string | null; situacao_desde: string | null; app_url: string | null } | null;
      if (!v || !v.contact_id) {
        await concluir("superada", "o vínculo com o Atlas sumiu ou a ficha foi apagada — nada foi disparado");
        continue;
      }
      const guardada = instante(v.situacao_desde);
      const daMudanca = instante(m.situacao_desde)!;
      if (guardada !== null && guardada > daMudanca) {
        await concluir("superada", "a situação mudou de novo no Atlas antes do disparo — nada foi disparado");
        continue;
      }
      if (guardada === null || guardada < daMudanca) {
        // Só ESPERA quem ainda está na situação ANTERIOR: a escrita desta
        // mudança não chegou, e a página relida a grava (o INSERT dá 23505 e
        // segue). Outra situação sem esta data = o vínculo foi regravado por
        // outro caminho, e esta escrita nunca vai chegar. Decide o dado, não
        // o relógio: uma trava de idade perderia a mudança de vez (a linha
        // `feito` ocupa a chave e a releitura não a enfileira de novo).
        if (situacaoComparavel(v.situacao) === situacaoComparavel(m.situacao_anterior)) {
          await devolver("aguardando a leitura gravar a situação no vínculo", false);
        } else await concluir("superada", "o vínculo foi regravado com outra situação, sem a data desta mudança — nada foi disparado");
        continue;
      }
      if (situacaoComparavel(v.situacao) !== situacaoComparavel(m.situacao_nova)) {
        await concluir("superada", "a situação do vínculo já é outra — nada foi disparado");
        continue;
      }
      const contactId = v.contact_id;

      // 5) As automações que escutam esta situação.
      const casam = ligadas.filter((a) => casaSituacao(a.trigger_config, m.situacao_nova));
      if (casam.length === 0) {
        await concluir("sem_automacao", `nenhuma automação ativa escuta a situação "${situacaoComparavel(m.situacao_nova)}"`);
        continue;
      }

      // 6) ⚠️⚠️ UMA leitura dos cards e UMA da conversa, ANTES de disparar qualquer uma.
      const funis = [...new Set(casam.flatMap((a) => lerConfigDoGatilho(a.trigger_config).pipelineIds))];
      let cards: CardDoContato[] = [];
      if (funis.length > 0) {
        const { data, error } = await admin.from("deals").select("id, pipeline_id, status").eq("account_id", accountId).eq("contact_id", contactId).in("pipeline_id", funis);
        if (error) throw new FalhaDeLeitura(`os cards do cliente não puderam ser lidos: ${error.message}`);
        cards = ((data ?? []) as { id: string; pipeline_id: string; status: DealStatus | null }[]).map((c) => ({
          id: String(c.id),
          pipeline_id: String(c.pipeline_id),
          status: c.status ?? null,
        }));
      }
      // ⚠️ Não é `conversaDoContato` do ZapSign: aquela engole o erro e devolve "sem conversa".
      const { data: conversa, error: erroConversa } = await admin
        .from("conversations")
        .select("id, channel_id")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (erroConversa) throw new FalhaDeLeitura(`a conversa do cliente não pôde ser lida: ${erroConversa.message}`);
      const conv = conversa as { id: string; channel_id: string | null } | null;
      const vars = variaveisDaMudanca({
        anterior: m.situacao_anterior,
        nova: m.situacao_nova,
        desde: m.situacao_desde,
        appUrl: v.app_url,
        atlasClientId: m.atlas_client_id,
      });

      // 7) Por automação, em memória. Daqui em diante a mudança NUNCA volta à fila se algo rodou.
      const saidas: SaidaDaAutomacao[] = [];
      for (const a of casam) {
        const escolha = cardDoEvento(cards, lerConfigDoGatilho(a.trigger_config).pipelineIds);
        if (escolha.tipo === "nenhum") {
          saidas.push({ nome: a.name, tipo: "sem_card" });
          continue;
        }
        if (escolha.tipo === "varios") {
          saidas.push({ nome: a.name, tipo: "card_ambiguo", quantos: escolha.quantos });
          continue;
        }
        disparou = true;
        const r = await disparar({
          accountId,
          triggerType: GATILHO_DO_ATLAS,
          contactId,
          context: {
            automation_id: a.id,
            deal_id: escolha.card.id,
            deal_status_fixado: escolha.card.status,
            conversation_id: conv?.id ?? undefined,
            channel_id: conv?.channel_id ?? null,
            vars,
          },
        });
        saidas.push({ nome: a.name, tipo: "disparo", executadas: r.executadas, foraDoEscopo: r.foraDoEscopo, comFalha: r.comFalha, emEspera: r.emEspera, erro: r.erro });
      }
      const desfecho = resultadoDaMudanca(saidas);
      if (desfecho.resultado === null) await devolver(desfecho.detalhe, true);
      else await concluir(desfecho.resultado, desfecho.detalhe);
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      console.error(`[atlas] mudança ${m.id}:`, motivo);
      // Antes do primeiro disparo nada rodou: repetir é seguro. Depois, NUNCA
      // (o motor não lança, mas um disparo que estourou pode ter falado com o cliente).
      if (disparou) await concluir("falhou", `o disparo não terminou (${motivo}) — confira o histórico das automações; nada foi repetido`);
      else await devolver(motivo, true);
    }
  }
  return { ok: true, contagem };
}
