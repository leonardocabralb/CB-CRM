import { RESULTADOS_DO_EVENTO, type ResultadoDoEvento } from "./log";

/**
 * O cartão "ZapSign" da aba Integrações, montado a partir da linha de config
 * (SEM segredos — a rota não lê o token nem a credencial) e da página de
 * eventos. Puro.
 */

export interface ConfigDoZapSign {
  plano: string | null;
  webhook_estado: string | null;
  status: string;
  last_error: string | null;
  last_event_at: string | null;
  conectado_em: string | null;
  conferido_em: string | null;
}

export interface EventoDoZapSign {
  id: string;
  doc_token: string;
  event_type: string;
  documento_nome: string | null;
  signatario_nome: string | null;
  resultado: ResultadoDoEvento | string;
  casado_por: string | null;
  contact_id: string | null;
  deal_id: string | null;
  detalhe: string | null;
  recebido_em: string;
  processado_em: string | null;
}

export type EstadoDoZapSign = "nao_conectado" | "conectado" | "erro";

export interface CartaoDoZapSign {
  estado: EstadoDoZapSign;
  plano: string | null;
  /** `ativo` | `ausente` | `erro` — nulo quando não conectado. */
  webhook: "ativo" | "ausente" | "erro" | null;
  /** Código do problema (a tela traduz), ou nulo. */
  erro: string | null;
  ultimoEvento: string | null;
  conectadoEm: string | null;
  conferidoEm: string | null;
  /** Contagem da PÁGINA mostrada (os mais recentes), não da conta inteira. */
  contagem: Record<ResultadoDoEvento, number>;
}

export function cartaoDoZapSign(config: ConfigDoZapSign | null, eventos: readonly Pick<EventoDoZapSign, "resultado">[]): CartaoDoZapSign {
  const contagem = Object.fromEntries(RESULTADOS_DO_EVENTO.map((r) => [r, 0])) as Record<ResultadoDoEvento, number>;
  for (const e of eventos) {
    if (e.resultado in contagem) contagem[e.resultado as ResultadoDoEvento] += 1;
  }
  if (!config) {
    return { estado: "nao_conectado", plano: null, webhook: null, erro: null, ultimoEvento: null, conectadoEm: null, conferidoEm: null, contagem };
  }
  const webhook = config.webhook_estado === "ativo" || config.webhook_estado === "erro" ? config.webhook_estado : "ausente";
  // ⚠️ Webhook que não está ativo é ERRO no chip: a conexão está de pé, mas
  // nenhuma assinatura chega — é exatamente o que o operador precisa ver.
  const erro =
    config.status === "erro"
      ? (config.last_error ?? "zapsign_error")
      : webhook === "ausente"
        ? (config.last_error ?? "webhook_ausente")
        : webhook === "erro"
          ? (config.last_error ?? "zapsign_error")
          : null;
  return {
    estado: config.status === "erro" || webhook !== "ativo" ? "erro" : "conectado",
    plano: config.plano,
    webhook,
    erro,
    ultimoEvento: config.last_event_at,
    conectadoEm: config.conectado_em,
    conferidoEm: config.conferido_em,
    contagem,
  };
}
