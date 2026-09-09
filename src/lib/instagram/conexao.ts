// ============================================================
// O que a CONEXÃO do Instagram carrega além do token — puro, sem I/O, e
// SEM `node:crypto`: o painel de conexões importa daqui (validade, aviso,
// caminho do webhook). O verify token aleatório mora em `verify-token.ts`,
// que é só do servidor.
//
// O token do painel dura 60 dias — medido na Fase 0 (`expires_in`
// 5.183.944 s). A validade gravada é o que a tela mostra e o que o cron da
// Fase 6 usa para decidir renovar.
// ============================================================

export const VALIDADE_DO_TOKEN_DIAS = 60;

/** Abaixo disto a tela avisa que o token está para vencer. */
export const AVISO_DE_VENCIMENTO_DIAS = 10;

/** ISO do vencimento de um token gerado AGORA. */
export function validadeDoToken(agora: Date = new Date()): string {
  return new Date(
    agora.getTime() + VALIDADE_DO_TOKEN_DIAS * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * Dias inteiros até o vencimento (negativo = vencido). `null` quando o canal
 * não tem validade gravada — canal de WhatsApp, ou linha anterior à 989.
 */
export function diasParaVencer(
  expiresAt: string | null | undefined,
  agora: Date = new Date()
): number | null {
  if (!expiresAt) return null;
  const ms = Date.parse(expiresAt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ms - agora.getTime()) / (24 * 60 * 60 * 1000));
}

/** O caminho da rota real do webhook (Fase 3) — a tela mostra `origin` + isto. */
export const CAMINHO_DO_WEBHOOK = '/api/cb/instagram/webhook';
