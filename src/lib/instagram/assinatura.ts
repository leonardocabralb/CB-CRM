// ============================================================
// A assinatura dos webhooks do Instagram (Meta).
//
// Cabeçalho `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 do CORPO CRU.
// É o mesmo mecanismo do webhook do WhatsApp
// (`src/lib/whatsapp/webhook-signature.ts`), com uma diferença de desenho
// que é o motivo de este arquivo existir: aqui o segredo entra por
// PARÂMETRO, nunca por `process.env`.
//
// ⚠️ MEDIDO na Fase 0 (Teste B, 09/09/2026): quem assina é o **Instagram
// App Secret** da aba do produto — NÃO a "Chave secreta do aplicativo" de
// App settings › Basic, que a documentação sugere. `META_APP_SECRET` global
// não serve, e o segredo é POR CANAL (`cb_channels.ig_app_secret`, cifrado):
// no dia em que houver um app Meta do WhatsApp e outro do Instagram, cada
// um assina com o seu.
//
// ⚠️ O corpo tem de ser o TEXTO CRU do pedido (`request.text()`).
// `request.json()` recodifica e o HMAC nunca bate.
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export const PREFIXO = 'sha256=';

/** O cabeçalho esperado para este corpo e este segredo. */
export function assinar(corpoCru: string, segredo: string): string {
  return PREFIXO + createHmac('sha256', segredo).update(corpoCru).digest('hex');
}

export function assinaturaCasa(
  header: string | null | undefined,
  corpoCru: string,
  segredo: string
): boolean {
  // Segredo vazio NUNCA casa: "canal sem segredo" não pode virar "aceita
  // tudo" — seria a porta aberta que a assinatura existe para fechar.
  if (!segredo || !header) return false;
  const recebidoTexto = header.trim().toLowerCase();
  if (!recebidoTexto.startsWith(PREFIXO)) return false;
  const esperado = Buffer.from(assinar(corpoCru, segredo), 'utf8');
  const recebido = Buffer.from(recebidoTexto, 'utf8');
  // timingSafeEqual lança com tamanhos diferentes — e tamanho diferente já é
  // resposta: não casa.
  if (esperado.length !== recebido.length) return false;
  return timingSafeEqual(esperado, recebido);
}
