/**
 * Puro: o que o cartão "Atlas" de Integrações mostra, a partir da linha de
 * `cb_atlas_config` SEM a chave (a rota nunca a seleciona).
 */

export interface ConfigDoAtlas {
  escritorio: string | null;
  status: string;
  last_error: string | null;
  conectado_em: string | null;
  conferido_em: string | null;
}

export type EstadoDoAtlas = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoAtlas {
  estado: EstadoDoAtlas;
  /** O código do problema (vira `motivo.<codigo>` na tela); nulo sem problema. */
  erro: string | null;
  escritorio: string | null;
  conectadoEm: string | null;
  conferidoEm: string | null;
}

export function cartaoDoAtlas(config: ConfigDoAtlas | null): CartaoDoAtlas {
  if (!config) return { estado: "nao_conectado", erro: null, escritorio: null, conectadoEm: null, conferidoEm: null };
  const comErro = config.status === "erro";
  return {
    estado: comErro ? "erro" : "conectado",
    erro: comErro ? (config.last_error ?? "atlas_error") : null,
    escritorio: config.escritorio,
    conectadoEm: config.conectado_em,
    conferidoEm: config.conferido_em,
  };
}
