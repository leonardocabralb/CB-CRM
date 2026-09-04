/**
 * O cartão "Meta Ads" da aba Integrações, montado a partir da linha de
 * config (SEM o token — a rota já a devolve sem ele) e das campanhas. Puro.
 */

export interface ConfigDoMetaAds {
  ad_account_id: string;
  nome_da_conta: string | null;
  moeda: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}

export interface CampanhaDoMetaAds {
  id: string;
  campaign_id: string;
  nome: string;
  status_meta: string | null;
  pipeline_id: string | null;
  last_seen_at: string;
}

export type EstadoDoMetaAds = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoMetaAds {
  estado: EstadoDoMetaAds;
  conta: { id: string; nome: string; moeda: string } | null;
  ultimaSync: string | null;
  /** código do último erro de sincronização (a tela traduz) */
  erro: string | null;
  campanhas: number;
  ativas: number;
  semFunil: number;
}

export function cartaoDoMetaAds(config: ConfigDoMetaAds | null, campanhas: readonly CampanhaDoMetaAds[]): CartaoDoMetaAds {
  if (!config) {
    return { estado: "nao_conectado", conta: null, ultimaSync: null, erro: null, campanhas: 0, ativas: 0, semFunil: 0 };
  }
  return {
    estado: config.status === "erro" ? "erro" : "conectado",
    conta: { id: config.ad_account_id, nome: config.nome_da_conta ?? config.ad_account_id, moeda: config.moeda ?? "BRL" },
    ultimaSync: config.last_sync_at,
    erro: config.status === "erro" ? config.last_error : null,
    campanhas: campanhas.length,
    ativas: campanhas.filter((c) => c.status_meta === "ACTIVE").length,
    semFunil: campanhas.filter((c) => c.pipeline_id === null).length,
  };
}
