import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";

import { criarClienteMeta, MetaAdsError, type ClienteMeta } from "./cliente";
import { janelaDeSync } from "./janela-de-sync";

/**
 * A sincronização de UMA conta: relê as campanhas (upsert por id, sem tocar
 * o `pipeline_id` que o operador atribuiu), puxa o gasto por dia da janela
 * (3 dias; 90 na primeira) e carimba `last_sync_at`/`last_error`.
 *
 * ⚠️ A janela é RECONCILIADA, não só sobrescrita. Quando a Meta reprocessa
 * um dia para ZERO, ela OMITE a linha em vez de devolver 0 — um upsert
 * cego deixaria o valor antigo gravado, e ao sair da janela de 3 dias esse
 * número errado viraria permanente, inflando investimento, custo por lead e
 * CAC para sempre (achado do Codex no PR #123). Por isso, depois do upsert,
 * o que estava na janela e NÃO voltou no retrato é apagado.
 *
 * Roda com o client de SERVICE ROLE (as três tabelas são fechadas para o
 * navegador). Chamada pelo cron, pelo "Sincronizar agora" e, em `after()`,
 * logo depois de conectar. Falha da Meta vira `status = 'erro'` com o
 * CÓDIGO em `last_error` — a tela traduz; a mensagem crua vai só ao log.
 */

export type ResultadoDaSync =
  | { ok: true; campanhas: number; dias: number; linhasDeGasto: number }
  | { ok: false; codigo: string };

const LOTE = 500;

export async function sincronizarMetaAds(
  admin: SupabaseClient,
  accountId: string,
  opcoes: { agora?: Date; primeira?: boolean; cliente?: (token: string) => ClienteMeta } = {},
): Promise<ResultadoDaSync> {
  const agora = opcoes.agora ?? new Date();
  const { data: config, error: erroConfig } = await admin
    .from("cb_meta_ads_config")
    .select("account_id, ad_account_id, access_token, last_sync_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (erroConfig) return { ok: false, codigo: "db_error" };
  if (!config) return { ok: false, codigo: "nao_conectado" };

  let token: string;
  try {
    token = decrypt(config.access_token);
  } catch {
    await marcarErro(admin, accountId, "chave_ilegivel");
    return { ok: false, codigo: "chave_ilegivel" };
  }

  const cliente = (opcoes.cliente ?? criarClienteMeta)(token);
  const primeira = opcoes.primeira ?? !config.last_sync_at;
  const janela = janelaDeSync(agora, primeira);

  try {
    const campanhas = await cliente.campanhas(config.ad_account_id);
    if (campanhas.length > 0) {
      const { error } = await admin.from("cb_meta_ads_campanhas").upsert(
        campanhas.map((c) => ({
          account_id: accountId,
          campaign_id: c.id,
          nome: c.nome,
          status_meta: c.status,
          last_seen_at: agora.toISOString(),
        })),
        { onConflict: "account_id,campaign_id" },
      );
      if (error) throw new Error(`campanhas: ${error.message}`);
    }

    const gastos = await cliente.gastos(config.ad_account_id, janela.since, janela.until);
    for (let i = 0; i < gastos.length; i += LOTE) {
      const { error } = await admin.from("cb_meta_ads_gastos").upsert(
        gastos.slice(i, i + LOTE).map((g) => ({
          account_id: accountId,
          campaign_id: g.campaignId,
          dia: g.dia,
          gasto: g.gasto,
          atualizado_em: agora.toISOString(),
        })),
        { onConflict: "account_id,campaign_id,dia" },
      );
      if (error) throw new Error(`gastos: ${error.message}`);
    }
    await apagarOqueSumiu(admin, accountId, janela.since, janela.until, gastos);

    await admin
      .from("cb_meta_ads_config")
      .update({ status: "conectado", last_sync_at: agora.toISOString(), last_error: null, updated_at: agora.toISOString() })
      .eq("account_id", accountId);

    return { ok: true, campanhas: campanhas.length, dias: janela.dias, linhasDeGasto: gastos.length };
  } catch (e) {
    const codigo = e instanceof MetaAdsError ? e.codigo : "db_error";
    console.error(`[meta-ads] sincronização da conta ${accountId} falhou (${codigo}):`, e instanceof Error ? e.message : e);
    await marcarErro(admin, accountId, codigo);
    return { ok: false, codigo };
  }
}

/**
 * Apaga da janela o que o retrato da Meta NÃO trouxe. Agrupado POR DIA
 * (`.eq('dia').in('campaign_id', …)`): na janela normal são 3 consultas, e
 * na primeira sincronização a tabela está vazia, então são zero. Uma
 * consulta por par (campanha, dia) seria centenas.
 */
async function apagarOqueSumiu(
  admin: SupabaseClient,
  accountId: string,
  since: string,
  until: string,
  retrato: readonly { campaignId: string; dia: string }[],
): Promise<void> {
  const { data: existentes, error } = await admin
    .from("cb_meta_ads_gastos")
    .select("campaign_id, dia")
    .eq("account_id", accountId)
    .gte("dia", since)
    .lte("dia", until);
  // Não sabemos o que está lá: apagar às cegas tiraria gasto legítimo.
  if (error || !existentes) return;

  const noRetrato = new Set(retrato.map((g) => `${g.dia}|${g.campaignId}`));
  const porDia = new Map<string, string[]>();
  for (const linha of existentes as { campaign_id: string; dia: string }[]) {
    if (noRetrato.has(`${linha.dia}|${linha.campaign_id}`)) continue;
    const lista = porDia.get(linha.dia) ?? [];
    lista.push(linha.campaign_id);
    porDia.set(linha.dia, lista);
  }

  for (const [dia, campanhas] of porDia) {
    for (let i = 0; i < campanhas.length; i += LOTE) {
      const { error: erroDelete } = await admin
        .from("cb_meta_ads_gastos")
        .delete()
        .eq("account_id", accountId)
        .eq("dia", dia)
        .in("campaign_id", campanhas.slice(i, i + LOTE));
      if (erroDelete) throw new Error(`limpeza da janela: ${erroDelete.message}`);
    }
  }
}

async function marcarErro(admin: SupabaseClient, accountId: string, codigo: string): Promise<void> {
  await admin
    .from("cb_meta_ads_config")
    .update({ status: "erro", last_error: codigo, updated_at: new Date().toISOString() })
    .eq("account_id", accountId);
}
