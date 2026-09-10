// ============================================================
// Login do Instagram (Business Login for Instagram — OAuth). Só servidor.
//
// O caminho, conferido na doc da Meta em 09/09/2026:
//   1. `GET https://www.instagram.com/oauth/authorize?client_id&redirect_uri&
//      response_type=code&scope&state` — a pessoa entra na conta profissional
//      e autoriza; o Instagram devolve `?code=…&state=…` (ou `?error=…`).
//   2. `POST https://api.instagram.com/oauth/access_token` (form) troca o
//      código (1 h, uso único) por um token CURTO (1 h) + `user_id` +
//      `permissions` — as que a pessoa de fato concedeu.
//   3. `GET https://graph.instagram.com/access_token?grant_type=
//      ig_exchange_token` troca o curto pelo LONGO (60 dias): o mesmo token
//      que o botão do painel gera, renovável pelo `refresh_access_token`.
//
// O que morde:
//   · O `state` é ASSINADO (HMAC com chave DERIVADA da ENCRYPTION_KEY) e
//     carrega conta, membro, nonce e validade; o nonce repete num cookie
//     HttpOnly. Sem isso, um link de callback forjado amarraria o Instagram
//     de um estranho à conta do escritório (login CSRF).
//   · A URI de retorno tem de cair na MESMA origem em que a sessão e o
//     cookie vivem. `origemDoPedido` lê o pedido (`x-forwarded-*`, que o
//     Traefik escreve), mas quem manda é `NEXT_PUBLIC_SITE_URL`: pedido do
//     host do site vira a URL canônica, host PÚBLICO estranho no cabeçalho
//     é ignorado (cai no site), e só um host local/privado (o preview em
//     `localhost`) passa como veio. A Meta só aceita o que está registrado.
//   · Segredo, código e token passam por `semSegredo` em toda mensagem de
//     erro (a Meta ecoa os três). O token CURTO viaja na query do passo 3
//     porque é a forma documentada daquele endpoint: vive 1 h, nunca é
//     gravado, e nenhum log nosso imprime a URL. O resto segue com `Bearer`.
// ============================================================

import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

import { ehUrlAlcancavel } from '@/lib/cb-channels/webhook-url';

import { CAMINHO_DO_CALLBACK } from './conexao';
import {
  INSTAGRAM_GRAPH,
  InstagramApiError,
  codigoDoErro,
  semSegredo,
} from './graph';

/** O que o CRM pede: identidade da conta e as mensagens. Nada de comentário
 *  nem publicação — permissão a mais é tela de consentimento a mais. */
export const PERMISSOES_DO_LOGIN = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
] as const;
export const PERMISSAO_DE_MENSAGENS = 'instagram_business_manage_messages';

/**
 * Os campos que a conta passa a entregar ao app (`/me/subscribed_apps`).
 * São os que `interpretarWebhook` sabe ler; `comments`/`live_comments`
 * ficam fora porque o CRM não os consome.
 */
export const CAMPOS_DO_WEBHOOK = [
  'messages',
  'message_reactions',
  'message_edit',
  'messaging_postbacks',
  'messaging_referral',
  'messaging_seen',
] as const;

export const COOKIE_DO_OAUTH = 'cb_ig_oauth';
/** Entrar na conta com verificação em duas etapas leva minutos, não segundos. */
export const VALIDADE_DO_ESTADO_MS = 15 * 60_000;

const AUTORIZACAO = 'https://www.instagram.com/oauth/authorize';
const TROCA_DO_CODIGO = 'https://api.instagram.com/oauth/access_token';
const TIMEOUT_MS = 15_000;

// ------------------------------------------------------------
// Origem e URLs
// ------------------------------------------------------------

/**
 * A origem que o NAVEGADOR usou para chegar aqui — com `NEXT_PUBLIC_SITE_URL`
 * como árbitro. O cabeçalho `Host`/`x-forwarded-host` é do cliente, e sem
 * sessão a rota responde com um redirect antes de qualquer checagem: um
 * `curl -H 'x-forwarded-host: evil.example'` não pode virar
 * `Location: https://evil.example/...` (achado da revisão do PR #189).
 *
 *   · host do pedido == host do site → a URL canônica do site (proto incluído);
 *   · host local/privado (o preview em `localhost`) → o pedido, como veio;
 *   · qualquer outro host público → o site (o cabeçalho é ignorado);
 *   · sem `NEXT_PUBLIC_SITE_URL` (instalação sem a env) → o pedido.
 */
export function origemDoPedido(
  request: Request,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL
): string {
  const primeiro = (v: string | null) => v?.split(',')[0]?.trim() ?? '';
  const url = new URL(request.url);
  const proto =
    primeiro(request.headers.get('x-forwarded-proto')) ||
    url.protocol.replace(/:$/, '');
  const host =
    primeiro(request.headers.get('x-forwarded-host')) ||
    primeiro(request.headers.get('host')) ||
    url.host;
  const pedido =
    /^https?$/.test(proto) && /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host)
      ? `${proto}://${host}`
      : url.origin;

  const site = origemDoSite(siteUrl);
  if (!site) return pedido;
  if (hostnameDe(pedido) === hostnameDe(site)) return site;
  if (!ehUrlAlcancavel(pedido)) return pedido;
  return site;
}

function origemDoSite(siteUrl: string | undefined): string | null {
  const bruto = siteUrl?.trim().replace(/\/+$/, '');
  if (!bruto) return null;
  try {
    return new URL(bruto).origin;
  } catch {
    return null;
  }
}

function hostnameDe(origem: string): string {
  try {
    return new URL(origem).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function urlDeRedirecionamento(origem: string): string {
  return `${origem.replace(/\/+$/, '')}${CAMINHO_DO_CALLBACK}`;
}

export function urlDeAutorizacao(args: {
  appId: string;
  redirectUri: string;
  estado: string;
}): string {
  const u = new URL(AUTORIZACAO);
  u.searchParams.set('client_id', args.appId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', PERMISSOES_DO_LOGIN.join(','));
  u.searchParams.set('state', args.estado);
  // Mais de uma conta do escritório: sem isto o Instagram autorizaria a
  // conta que já está logada no navegador, sem perguntar qual.
  u.searchParams.set('force_reauth', 'true');
  return u.toString();
}

// ------------------------------------------------------------
// O `state` assinado
// ------------------------------------------------------------

export interface ConteudoDoEstado {
  accountId: string;
  userId: string;
  nonce: string;
  /** Epoch ms. */
  exp: number;
}

/**
 * Chave DERIVADA da mestra, não a própria: a ENCRYPTION_KEY já cifra tokens
 * com AES-GCM, e uma chave por uso é o que impede um vazamento de um lado
 * alcançar o outro.
 */
export function chaveDoEstado(
  chaveMestra: string = process.env.ENCRYPTION_KEY ?? ''
): Buffer {
  const mestra = Buffer.from(chaveMestra, 'hex');
  if (mestra.length < 16) {
    throw new Error(
      'ENCRYPTION_KEY ausente ou curta demais para assinar o state do OAuth.'
    );
  }
  return Buffer.from(
    hkdfSync('sha256', mestra, '', 'cb-instagram-oauth-state', 32)
  );
}

export function novoNonce(): string {
  return randomBytes(16).toString('hex');
}

function assinar(payload: string, chave: Buffer): string {
  return createHmac('sha256', chave).update(payload).digest('base64url');
}

export function criarEstado(
  conteudo: { accountId: string; userId: string; nonce: string },
  agoraMs: number = Date.now(),
  chave: Buffer = chaveDoEstado()
): string {
  const completo: ConteudoDoEstado = {
    ...conteudo,
    exp: agoraMs + VALIDADE_DO_ESTADO_MS,
  };
  const payload = Buffer.from(JSON.stringify(completo), 'utf8').toString(
    'base64url'
  );
  return `${payload}.${assinar(payload, chave)}`;
}

/** `null` para assinatura errada, forma estranha ou validade vencida. */
export function lerEstado(
  estado: string | null | undefined,
  agoraMs: number = Date.now(),
  chave: Buffer = chaveDoEstado()
): ConteudoDoEstado | null {
  if (!estado) return null;
  const partes = estado.split('.');
  if (partes.length !== 2) return null;
  const [payload, mac] = partes;
  const esperado = Buffer.from(assinar(payload, chave));
  const recebido = Buffer.from(mac);
  if (
    esperado.length !== recebido.length ||
    !timingSafeEqual(esperado, recebido)
  ) {
    return null;
  }
  let bruto: unknown;
  try {
    bruto = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!ehObjeto(bruto)) return null;
  if (
    typeof bruto.accountId !== 'string' ||
    typeof bruto.userId !== 'string' ||
    typeof bruto.nonce !== 'string' ||
    typeof bruto.exp !== 'number'
  ) {
    return null;
  }
  if (bruto.exp <= agoraMs) return null;
  return {
    accountId: bruto.accountId,
    userId: bruto.userId,
    nonce: bruto.nonce,
    exp: bruto.exp,
  };
}

// ------------------------------------------------------------
// As duas trocas
// ------------------------------------------------------------

type Fetch = typeof fetch;

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

interface ErroDaMeta {
  message?: string;
  code?: number;
  error_subcode?: number;
}

/**
 * O erro vem em DUAS formas: a do Graph (`{error:{message,code}}`) e a do
 * `api.instagram.com` (`{error_type, code, error_message}`).
 */
function erroDaResposta(corpo: unknown): ErroDaMeta | null {
  if (!ehObjeto(corpo)) return null;
  if (ehObjeto(corpo.error)) return corpo.error as ErroDaMeta;
  if (typeof corpo.error_message === 'string') {
    return {
      message: corpo.error_message,
      code: typeof corpo.code === 'number' ? corpo.code : undefined,
    };
  }
  return null;
}

async function pedir(
  url: string,
  init: RequestInit,
  segredos: readonly string[],
  fetchFn: Fetch
): Promise<Record<string, unknown>> {
  const limpar = (texto: string) =>
    segredos.reduce((s, segredo) => semSegredo(s, segredo), texto);
  let resposta: Response;
  try {
    resposta = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new InstagramApiError(
      'rede',
      limpar(e instanceof Error ? e.message : String(e))
    );
  }
  const corpo: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const erro = erroDaResposta(corpo);
    throw new InstagramApiError(
      codigoDoErro(resposta.status, erro),
      limpar(erro?.message ?? `HTTP ${resposta.status}`),
      resposta.status,
      erro?.code ?? null,
      erro?.error_subcode ?? null
    );
  }
  if (!ehObjeto(corpo)) {
    throw new InstagramApiError('meta_error', 'Resposta sem corpo JSON');
  }
  return corpo;
}

export interface TokenCurto {
  token: string;
  igUserId: string;
  /**
   * As permissões que a pessoa CONCEDEU — pode ter desmarcado uma. `null`
   * quando a Meta não mandou o campo: "não sei" é diferente de "não
   * concedeu", e tratar os dois igual recusaria a conexão para sempre.
   */
  permissoes: string[] | null;
}

export async function trocarCodigoPorToken(
  args: { appId: string; appSecret: string; redirectUri: string; code: string },
  fetchFn: Fetch = fetch
): Promise<TokenCurto> {
  const corpo = new URLSearchParams({
    client_id: args.appId,
    client_secret: args.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: args.redirectUri,
    code: args.code,
  });
  const r = await pedir(
    TROCA_DO_CODIGO,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: corpo.toString(),
    },
    [args.appSecret, args.code],
    fetchFn
  );
  // A doc mostra `{ data: [ { … } ] }` — só essa forma.
  const item = Array.isArray(r.data) && ehObjeto(r.data[0]) ? r.data[0] : null;
  if (!item) {
    throw new InstagramApiError(
      'meta_error',
      'A troca do código veio sem `data[0]`'
    );
  }
  const token = item.access_token;
  const userId = item.user_id;
  if (typeof token !== 'string' || !token) {
    throw new InstagramApiError(
      'meta_error',
      'A troca do código veio sem access_token'
    );
  }
  if (typeof userId !== 'string' && typeof userId !== 'number') {
    throw new InstagramApiError('meta_error', 'A troca do código veio sem user_id');
  }
  const permissoes =
    typeof item.permissions === 'string'
      ? item.permissions
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean)
      : Array.isArray(item.permissions)
        ? item.permissions.filter((p): p is string => typeof p === 'string')
        : null;
  return { token, igUserId: String(userId), permissoes };
}

export interface TokenLongo {
  token: string;
  expiraEmSeg: number;
}

export async function trocarPorTokenLongo(
  args: { appSecret: string; token: string },
  fetchFn: Fetch = fetch
): Promise<TokenLongo> {
  const u = new URL(`${INSTAGRAM_GRAPH}/access_token`);
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', args.appSecret);
  u.searchParams.set('access_token', args.token);
  const r = await pedir(
    u.toString(),
    { headers: { Accept: 'application/json' } },
    [args.appSecret, args.token],
    fetchFn
  );
  if (typeof r.access_token !== 'string' || !r.access_token) {
    throw new InstagramApiError(
      'meta_error',
      'A troca pelo token longo veio sem access_token'
    );
  }
  const expiraEmSeg = Number(r.expires_in);
  if (!Number.isFinite(expiraEmSeg) || expiraEmSeg <= 0) {
    throw new InstagramApiError(
      'meta_error',
      'A troca pelo token longo veio sem expires_in'
    );
  }
  return { token: r.access_token, expiraEmSeg };
}

/** ISO do vencimento MEDIDO — o que a Meta disse, não a presunção de 60 dias. */
export function vencimentoDoToken(
  expiraEmSeg: number,
  agora: Date = new Date()
): string {
  return new Date(agora.getTime() + expiraEmSeg * 1000).toISOString();
}
