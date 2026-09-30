/**
 * Puro: o que o cartão "Atlas" de Integrações mostra, a partir da linha de
 * `cb_atlas_config` SEM a chave (a rota nunca a seleciona).
 */

import { CASOU_POR, leituraVelha, ORIGENS_DO_VINCULO, type CasouPor, type OrigemDoVinculo } from "./leitura";

export interface ConfigDoAtlas {
  /** O ambiente em que a conexão nasceu (nulo = o Atlas de verdade); nunca vai à tela. */
  api_url?: string | null;
  escritorio: string | null;
  status: string;
  last_error: string | null;
  conectado_em: string | null;
  conferido_em: string | null;
  /** A leitura das situações (1072). */
  last_sync_at?: string | null;
  sync_erro?: string | null;
  listagem_completa_em?: string | null;
}

export type EstadoDoAtlas = "nao_conectado" | "conectado" | "erro";

export interface LeituraNoCartao {
  /** A última leitura SEM erro (nulo = ainda não leu). */
  ultimaEm: string | null;
  /** O código do erro da ÚLTIMA leitura (vira `motivo.<codigo>` na tela). */
  erro: string | null;
  /** Quando começou a última listagem completa. */
  completaEm: string | null;
  /** Sem leitura, com erro, ou há mais de uma hora — calculado aqui (a tela não lê o relógio no render). */
  velha: boolean;
}

export interface CartaoDoAtlas {
  estado: EstadoDoAtlas;
  /** O código do problema (vira `motivo.<codigo>` na tela); nulo sem problema. */
  erro: string | null;
  escritorio: string | null;
  conectadoEm: string | null;
  conferidoEm: string | null;
  /** A instância aponta para OUTRO Atlas (`ATLAS_API_URL`, o staging): o selo "Ambiente de teste", nunca a URL. */
  ambienteDeTeste: boolean;
  /** A leitura das situações — só da conexão DESTE ambiente. */
  leitura: LeituraNoCartao | null;
}

/** As fichas vinculadas (com ficha, deste ambiente e escritório), por como nasceram. */
export interface ContagemDosVinculos {
  total: number;
  porOrigem: Record<OrigemDoVinculo, number>;
  porCasamento: Record<CasouPor, number>;
}

export function contagemVazia(): ContagemDosVinculos {
  return {
    total: 0,
    porOrigem: Object.fromEntries(ORIGENS_DO_VINCULO.map((o) => [o, 0])) as Record<OrigemDoVinculo, number>,
    porCasamento: Object.fromEntries(CASOU_POR.map((c) => [c, 0])) as Record<CasouPor, number>,
  };
}

/**
 * `ambiente` é o desta instância (`ambienteDoAtlas()`): a conexão feita em
 * OUTRO ambiente aparece em erro (`outro_ambiente`) — o passo não a usa, e
 * a leitura dela não é mostrada.
 */
export function cartaoDoAtlas(config: ConfigDoAtlas | null, ambiente: string | null, agora: Date = new Date()): CartaoDoAtlas {
  const ambienteDeTeste = ambiente !== null;
  if (!config) return { estado: "nao_conectado", erro: null, escritorio: null, conectadoEm: null, conferidoEm: null, ambienteDeTeste, leitura: null };
  const outroAmbiente = (config.api_url ?? null) !== ambiente;
  const comErro = outroAmbiente || config.status === "erro";
  const ultimaEm = config.last_sync_at ?? null;
  const erroDaLeitura = config.sync_erro ?? null;
  return {
    estado: comErro ? "erro" : "conectado",
    erro: outroAmbiente ? "outro_ambiente" : comErro ? (config.last_error ?? "atlas_error") : null,
    escritorio: config.escritorio,
    conectadoEm: config.conectado_em,
    conferidoEm: config.conferido_em,
    ambienteDeTeste,
    leitura: outroAmbiente
      ? null
      : { ultimaEm, erro: erroDaLeitura, completaEm: config.listagem_completa_em ?? null, velha: leituraVelha(ultimaEm, erroDaLeitura, agora) },
  };
}
