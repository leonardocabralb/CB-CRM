/**
 * O cartão "tl;dv" da aba Integrações, montado a partir da linha de config
 * (SEM a chave — a rota já a devolve sem a coluna) e das contagens. Puro.
 */

export interface ConfigDoTldv {
  status: string;
  last_sync_at: string | null;
  last_event_at: string | null;
  last_error: string | null;
}

export interface ContagemDeReunioes {
  /** reuniões importadas do tl;dv */
  total: number;
  /** com a transcrição gravada */
  prontas: number;
  /** ainda esperando o tl;dv terminar a transcrição */
  pendentes: number;
  /** importadas e sem cliente vinculado — o que pede a mão do operador */
  semCliente: number;
}

export type EstadoDoTldv = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoTldv {
  estado: EstadoDoTldv;
  ultimaSync: string | null;
  ultimoEvento: string | null;
  /** código do último erro (a tela traduz) */
  erro: string | null;
  contagem: ContagemDeReunioes;
}

export function cartaoDoTldv(config: ConfigDoTldv | null, contagem: ContagemDeReunioes): CartaoDoTldv {
  if (!config) return { estado: "nao_conectado", ultimaSync: null, ultimoEvento: null, erro: null, contagem };
  return {
    estado: config.status === "erro" ? "erro" : "conectado",
    ultimaSync: config.last_sync_at,
    ultimoEvento: config.last_event_at,
    erro: config.status === "erro" ? config.last_error : null,
    contagem,
  };
}
