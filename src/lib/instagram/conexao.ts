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

/**
 * ISO do vencimento de um token gerado AGORA. É PRESUNÇÃO: o operador pode
 * colar um token gerado dias antes, e a data fica otimista. O cron da Fase 6
 * corrige pelo `expires_in` que a renovação devolve; até lá, a tela mostra
 * o teto, não a medida.
 */
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

/**
 * Onde o Instagram devolve a pessoa depois do login (OAuth). A tela mostra
 * `origin` + isto para o operador registrar no painel da Meta ("URIs de
 * redirecionamento OAuth válidos"); o servidor deriva a mesma URL do pedido.
 */
export const CAMINHO_DO_CALLBACK = '/api/cb/instagram/oauth/callback';

/**
 * Por que a volta do login do Instagram deu errado. O callback redireciona
 * para Conexões com `?instagram=erro&motivo=<um destes>`, e a tela traduz
 * cada um (`instagramOauthError*` — cobrado por teste nos dois dicionários).
 */
export const MOTIVOS_DO_OAUTH = [
  'sessao',
  'limite',
  'sem_app',
  'recusado',
  'estado',
  'permissao',
  'meta',
  'outra_conta',
  'erro',
] as const;
export type MotivoDoOAuth = (typeof MOTIVOS_DO_OAUTH)[number];

/** Um motivo desconhecido na URL vira `erro`, nunca chave crua na tela. */
export function motivoDoOAuth(valor: string | null | undefined): MotivoDoOAuth {
  return (MOTIVOS_DO_OAUTH as readonly string[]).includes(valor ?? '')
    ? (valor as MotivoDoOAuth)
    : 'erro';
}
