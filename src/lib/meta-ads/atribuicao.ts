import { localDayKey } from "@/lib/dashboard/date-utils";
import { fimDoIntervalo, type Intervalo } from "@/lib/funil/periodo";

/**
 * Gasto → funil. Puro. A Meta dá o gasto por campanha e por dia; o
 * operador diz a que funil cada campanha pertence (`cb_meta_ads_campanhas`);
 * aqui se soma o que cabe no período do painel.
 *
 * ⚠️ Campanha SEM funil não some: sai em `semFunil`, e o Desempenho AVISA.
 * Silenciada, o custo por lead sairia menor do que é.
 */

export interface CampanhaMapeada {
  campaign_id: string;
  nome: string;
  pipeline_id: string | null;
}

export interface GastoDoDia {
  campaign_id: string;
  /** AAAA-MM-DD */
  dia: string;
  gasto: number;
}

export interface GastoPorCampanha {
  campaignId: string;
  nome: string;
  gasto: number;
}

export interface GastoDoPeriodo {
  total: number;
  /** do funil, em ordem decrescente de gasto (só com gasto > 0) */
  porCampanha: GastoPorCampanha[];
  /** campanhas sem funil atribuído que gastaram no período */
  semFunil: { total: number; campanhas: number };
}

/** Chaves de dia LOCAIS (`[desde, ate)`) do intervalo do painel; nulo = sem limite. */
export function diasDoPeriodo(intervalo: Intervalo, agora: Date): { desde: string | null; ate: string | null } {
  const fim = fimDoIntervalo(intervalo, agora);
  return {
    desde: intervalo.desde ? localDayKey(intervalo.desde) : null,
    ate: fim ? localDayKey(fim) : null,
  };
}

function noPeriodo(dia: string, dias: { desde: string | null; ate: string | null }): boolean {
  if (dias.desde && dia < dias.desde) return false;
  if (dias.ate && dia >= dias.ate) return false;
  return true;
}

export function gastoDoPeriodo(
  gastos: readonly GastoDoDia[],
  campanhas: readonly CampanhaMapeada[],
  pipelineId: string,
  dias: { desde: string | null; ate: string | null },
): GastoDoPeriodo {
  const porId = new Map(campanhas.map((c) => [c.campaign_id, c]));
  const somaDoFunil = new Map<string, number>();
  const somaSemFunil = new Map<string, number>();

  for (const g of gastos) {
    if (!noPeriodo(g.dia, dias) || g.gasto <= 0) continue;
    const campanha = porId.get(g.campaign_id);
    if (!campanha) continue; // campanha ainda não sincronizada: sem nome, sem funil — não inventa
    if (campanha.pipeline_id === pipelineId) {
      somaDoFunil.set(g.campaign_id, (somaDoFunil.get(g.campaign_id) ?? 0) + g.gasto);
    } else if (campanha.pipeline_id === null) {
      somaSemFunil.set(g.campaign_id, (somaSemFunil.get(g.campaign_id) ?? 0) + g.gasto);
    }
  }

  const porCampanha = [...somaDoFunil.entries()]
    .map(([campaignId, gasto]) => ({ campaignId, nome: porId.get(campaignId)?.nome ?? campaignId, gasto }))
    .sort((a, b) => b.gasto - a.gasto || a.nome.localeCompare(b.nome));
  const total = porCampanha.reduce((s, c) => s + c.gasto, 0);
  const semFunilTotal = [...somaSemFunil.values()].reduce((s, v) => s + v, 0);

  return {
    total,
    porCampanha,
    semFunil: { total: semFunilTotal, campanhas: somaSemFunil.size },
  };
}

export interface Custos {
  custoPorLead: number | null;
  cac: number | null;
  /** custo por lead × perdidos — o que a aquisição gastou com quem se perdeu (D8) */
  custoDosPerdidos: number | null;
}

export function custos(investimento: number, entradas: number, contratos: number, perdidos: number): Custos {
  const custoPorLead = entradas > 0 ? investimento / entradas : null;
  return {
    custoPorLead,
    cac: contratos > 0 ? investimento / contratos : null,
    custoDosPerdidos: custoPorLead === null ? null : custoPorLead * perdidos,
  };
}
