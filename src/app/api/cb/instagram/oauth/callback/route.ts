// ============================================================
// /api/cb/instagram/oauth/callback — a volta do login do Instagram. Admin+.
//
// O Instagram devolve a pessoa aqui com `?code=…&state=…` (ou `?error=…`).
// A ordem importa, e cada passo tem a sua saída para Conexões
// (`?instagram=erro&motivo=…`, traduzido pela tela):
//   1. sessão de admin — o callback chega como navegação, com os cookies;
//   2. `state` assinado + nonce do cookie, amarrados à conta e ao membro
//      da sessão (login CSRF: um link forjado não amarra Instagram alheio);
//   3. código → token curto → token longo (`oauth.ts`);
//   4. a pessoa concedeu a permissão de mensagens? (dá para desmarcar na
//      tela de consentimento, e sem ela a conexão nasceria muda);
//   5. `/me` diz QUAL conta é; `/me/subscribed_apps` liga a entrega dos
//      webhooks — ANTES de gravar, para não nascer canal que não recebe;
//   6. grava (`canal.ts`) e volta com `?instagram=conectado&canal=…`.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { lerAppDoInstagram } from '@/lib/instagram/app';
import { gravarCanalDoInstagram } from '@/lib/instagram/canal';
import type { MotivoDoOAuth } from '@/lib/instagram/conexao';
import { InstagramApiError, criarClienteInstagram } from '@/lib/instagram/graph';
import {
  CAMPOS_DO_WEBHOOK,
  COOKIE_DO_OAUTH,
  PERMISSAO_DE_MENSAGENS,
  lerEstado,
  origemDoPedido,
  trocarCodigoPorToken,
  trocarPorTokenLongo,
  urlDeRedirecionamento,
  vencimentoDoToken,
} from '@/lib/instagram/oauth';

/** O que da mensagem da Meta cabe numa URL sem virar um romance. */
const TETO_DO_DETALHE = 200;

export async function GET(request: NextRequest) {
  const origem = origemDoPedido(request);
  const params = request.nextUrl.searchParams;

  const semCookie = (resposta: NextResponse) => {
    resposta.cookies.set({
      name: COOKIE_DO_OAUTH,
      value: '',
      maxAge: 0,
      path: '/api/cb/instagram/oauth',
    });
    return resposta;
  };
  const voltar = (motivo: MotivoDoOAuth, detalhe?: string) => {
    const url = new URL('/settings', origem);
    url.searchParams.set('tab', 'channels');
    url.searchParams.set('instagram', 'erro');
    url.searchParams.set('motivo', motivo);
    if (detalhe) url.searchParams.set('detalhe', detalhe.slice(0, TETO_DO_DETALHE));
    return semCookie(NextResponse.redirect(url));
  };

  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch {
    return voltar('sessao');
  }
  const limit = checkRateLimit(`cb:igOauth:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return voltar('limite');

  // A pessoa cancelou (ou o Instagram recusou antes de perguntar).
  if (params.get('error')) return voltar('recusado');

  const estado = lerEstado(params.get('state'));
  const nonce = request.cookies.get(COOKIE_DO_OAUTH)?.value;
  const code = params.get('code');
  if (
    !estado ||
    !nonce ||
    estado.nonce !== nonce ||
    estado.accountId !== ctx.accountId ||
    estado.userId !== ctx.userId ||
    !code
  ) {
    return voltar('estado');
  }

  let app;
  try {
    app = await lerAppDoInstagram(supabaseAdmin(), ctx.accountId);
  } catch (err) {
    console.error('[cb/instagram/oauth] app ilegível:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
  if (!app) return voltar('sem_app');

  try {
    const curto = await trocarCodigoPorToken({
      appId: app.appId,
      appSecret: app.appSecret,
      redirectUri: urlDeRedirecionamento(origem),
      code,
    });
    if (!curto.permissoes.includes(PERMISSAO_DE_MENSAGENS)) {
      return voltar('permissao');
    }
    const longo = await trocarPorTokenLongo({ appSecret: app.appSecret, token: curto.token });
    const cliente = criarClienteInstagram(longo.token);
    const perfil = await cliente.me();
    await cliente.assinarWebhooks(CAMPOS_DO_WEBHOOK);

    const r = await gravarCanalDoInstagram(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      // O @ é o nome que a equipe reconhece; "Configurar" renomeia.
      label: `@${perfil.username}`,
      accessToken: longo.token,
      igAppSecret: app.appSecret,
      humanAgent: false,
      perfil,
      tokenExpiraEm: vencimentoDoToken(longo.expiraEmSeg),
    });
    if (!r.ok) {
      return voltar(r.codigo === 'outra_conta' ? 'outra_conta' : 'erro');
    }

    const url = new URL('/settings', origem);
    url.searchParams.set('tab', 'channels');
    url.searchParams.set('instagram', 'conectado');
    url.searchParams.set('canal', r.canal.id);
    url.searchParams.set('username', perfil.username);
    return semCookie(NextResponse.redirect(url));
  } catch (err) {
    if (err instanceof InstagramApiError) {
      // A mensagem já vem sem segredo, código ou token (`semSegredo`).
      console.warn('[cb/instagram/oauth] a Meta recusou:', err.codigo, err.message);
      return voltar('meta', err.message);
    }
    console.error('[cb/instagram/oauth] falha inesperada:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
}
