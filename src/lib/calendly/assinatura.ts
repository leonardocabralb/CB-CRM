import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A assinatura dos webhooks do Calendly.
 *
 * Cabeçalho `Calendly-Webhook-Signature: t=<unix seg>,v1=<hex>`, em que
 * `v1` é HMAC-SHA256 da string `<t>.<corpo cru>` com a `signing_key` que
 * NÓS informamos ao criar a assinatura (é gerada aqui e guardada cifrada).
 * A doc recomenda rejeitar `t` velho — replay — com tolerância de minutos.
 *
 * ⚠️ O corpo tem de ser o TEXTO CRU do pedido. `request.json()` recodifica e
 * o HMAC nunca bate (a mesma lição do webhook da Meta).
 */

export const TOLERANCIA_SEG = 5 * 60;

export interface CabecalhoDeAssinatura {
  t: number;
  v1: string;
}

export function lerCabecalhoDeAssinatura(header: string | null | undefined): CabecalhoDeAssinatura | null {
  if (!header) return null;
  let t: number | null = null;
  let v1: string | null = null;
  for (const parte of header.split(",")) {
    const [chave, valor] = parte.trim().split("=");
    if (chave === "t" && valor && /^\d+$/.test(valor)) t = Number(valor);
    if (chave === "v1" && valor && /^[0-9a-f]+$/i.test(valor)) v1 = valor.toLowerCase();
  }
  return t !== null && v1 ? { t, v1 } : null;
}

/** O `v1` esperado para este corpo e este instante. */
export function assinar(corpoCru: string, chave: string, t: number): string {
  return createHmac("sha256", chave).update(`${t}.${corpoCru}`).digest("hex");
}

/** Cabeçalho pronto — para o teste e para simular uma entrega. */
export function montarCabecalho(corpoCru: string, chave: string, t: number): string {
  return `t=${t},v1=${assinar(corpoCru, chave, t)}`;
}

export function verificarAssinatura(
  header: string | null | undefined,
  corpoCru: string,
  chave: string,
  agoraSeg: number = Math.floor(Date.now() / 1000),
  toleranciaSeg: number = TOLERANCIA_SEG,
): boolean {
  if (!chave) return false;
  const lido = lerCabecalhoDeAssinatura(header);
  if (!lido) return false;
  if (Math.abs(agoraSeg - lido.t) > toleranciaSeg) return false;
  const esperado = Buffer.from(assinar(corpoCru, chave, lido.t), "utf8");
  const recebido = Buffer.from(lido.v1, "utf8");
  if (esperado.length !== recebido.length) return false;
  return timingSafeEqual(esperado, recebido);
}

/** 32 bytes em hex — a `signing_key` informada ao Calendly. */
export function gerarChaveDeAssinatura(): string {
  return randomBytes(32).toString("hex");
}

/**
 * O segredo que identifica a CONTA na URL do webhook
 * (`/api/cb/calendly/webhook/<token>`). Sem ele a rota não saberia de que
 * conta é a assinatura, e com a chave de assinatura POR conta ele também é
 * a primeira barreira contra um pedido forjado.
 */
export function gerarTokenDeWebhook(): string {
  return randomBytes(24).toString("base64url");
}
