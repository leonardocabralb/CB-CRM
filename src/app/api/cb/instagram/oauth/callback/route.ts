// ============================================================
// /api/cb/instagram/oauth/callback — a volta do login. Admin+.
//
// A Meta devolve a pessoa aqui com `?code=…&state=…` (ou `?error=…`), pelos
// dois logins (o tipo do app da conta decide qual, 1153).
// A ordem importa, e cada passo tem a sua saída para Conexões
// (`?instagram=erro&motivo=…`, traduzido pela tela):
//   1. sessão de admin — o callback chega como navegação, com os cookies;
//   2. `state` assinado + nonce do cookie, amarrados à conta e ao membro
//      da sessão (login CSRF: um link forjado não amarra Instagram alheio);
//   → login UNIFICADO: uma troca só, as contas que o login trouxe
//     (`lerContasDoToken`) e uma conexão por conta
//     (`conectarContasDoUnificado`); volta com a principal, quantas
//     `outras` entraram e as que `falharam`;
//   → login do INSTAGRAM, os passos abaixo:
//   3. código → token curto → token longo (`oauth.ts`);
//   4. a pessoa concedeu a permissão de mensagens? (dá para desmarcar na
//      tela de consentimento, e sem ela a conexão nasceria muda);
//   5. `/me` diz QUAL conta é; `/me/subscribed_apps` liga a entrega dos
//      webhooks — ANTES de gravar, para não nascer canal que não recebe;
//   6. grava (`canal.ts`) e volta com `?instagram=conectado&canal=…`.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ForbiddenError, UnauthorizedError, requireRole } from '@/lib/auth/account';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { lerAppDoInstagram } from '@/lib/instagram/app';
import { gravarCanalDoInstagram } from '@/lib/instagram/canal';
import { conectarContasDoUnificado } from '@/lib/instagram/conectar-unificado';
import type { MotivoDoOAuth } from '@/lib/instagram/conexao';
import {
  InstagramApiError,
  criarClienteInstagram,
  lerContasDoToken,
} from '@/lib/instagram/graph';
import {
  CAMPOS_DO_WEBHOOK,
  COOKIE_DO_OAUTH,
  PERMISSAO_DE_MENSAGENS,
  lerEstado,
  origemDoPedido,
  trocarCodigoPorToken,
  trocarCodigoUnificado,
  trocarPorTokenLongo,
  urlDeRedirecionamento,
  vencimentoDoToken,
} from '@/lib/instagram/oauth';

/** O que da mensagem da Meta cabe numa URL sem virar um romance. */
const TETO_DO_DETALHE = 200;

function motivoDaFalhaDeAcesso(err: unknown): MotivoDoOAuth {
  if (err instanceof UnauthorizedError) return 'sessao';
  if (err instanceof ForbiddenError) return 'sem_permissao';
  return 'erro';
}

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
  /**
   * `manterCookie`: antes de o `state` casar, a volta NÃO apaga o nonce —
   * senão uma navegação cross-site para `?error=x` (ou com state inventado)
   * mataria a autorização em voo de um admin. Depois do state válido, toda
   * saída apaga.
   */
  const voltar = (motivo: MotivoDoOAuth, detalhe?: string, manterCookie = false) => {
    const url = new URL('/settings', origem);
    url.searchParams.set('tab', 'channels');
    url.searchParams.set('instagram', 'erro');
    url.searchParams.set('motivo', motivo);
    if (detalhe) url.searchParams.set('detalhe', detalhe.slice(0, TETO_DO_DETALHE));
    const resposta = NextResponse.redirect(url);
    return manterCookie ? resposta : semCookie(resposta);
  };

  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    return voltar(motivoDaFalhaDeAcesso(err), undefined, true);
  }
  const limit = checkRateLimit(`cb:igOauth:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return voltar('limite', undefined, true);

  // A pessoa cancelou (ou o Instagram recusou antes de perguntar).
  if (params.get('error')) return voltar('recusado', undefined, true);

  let estado;
  try {
    estado = lerEstado(params.get('state'));
  } catch (err) {
    console.error('[cb/instagram/oauth] sem chave para o state:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
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
    return voltar('estado', undefined, true);
  }

  let app;
  try {
    app = await lerAppDoInstagram(supabaseAdmin(), ctx.accountId);
  } catch (err) {
    console.error('[cb/instagram/oauth] app ilegível:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
  if (!app) return voltar('sem_app');

  // ---- Login unificado (app novo, 1153): um login, várias contas ----
  if (app.login === 'unificado') {
    try {
      const troca = await trocarCodigoUnificado({
        appId: app.appId,
        appSecret: app.appSecret,
        redirectUri: urlDeRedirecionamento(origem),
        code,
      });
      const alcance = await lerContasDoToken(troca.token);
      if (alcance.contas.length === 0) return voltar('sem_contas');

      // O webhook do app é configurado UMA vez no painel da Meta: o diálogo
      // abre só para a primeira conexão do login unificado desta conta (a
      // conta pode vir do login do Instagram, cujo webhook é OUTRO, M1).
      // Leitura que falha conta como "não é a primeira", como no outro login.
      const { count, error: erroDaContagem } = await ctx.supabase
        .from('cb_channels')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('kind', 'instagram')
        .eq('ig_login', 'unificado');
      const primeira = !erroDaContagem && (count ?? 0) === 0;

      const r = await conectarContasDoUnificado(ctx.supabase, {
        accountId: ctx.accountId,
        userId: ctx.userId,
        appSecret: app.appSecret,
        token: troca.token,
        expiraEmSeg: troca.expiraEmSeg,
        alcance,
      });
      const [principal, ...outras] = r.conectadas;
      if (!principal) {
        const falha = r.naoEntraram[0];
        if (falha?.motivo === 'outra_conta') return voltar('outra_conta', falha.conta);
        if (falha?.motivo === 'meta') return voltar('meta', falha.detalhe ?? undefined);
        return voltar('erro');
      }
      const url = new URL('/settings', origem);
      url.searchParams.set('tab', 'channels');
      url.searchParams.set('instagram', 'conectado');
      url.searchParams.set('canal', principal.canalId);
      url.searchParams.set('username', principal.username);
      if (outras.length > 0) url.searchParams.set('outras', String(outras.length));
      if (r.naoEntraram.length > 0) {
        url.searchParams.set(
          'falharam',
          r.naoEntraram.map((f) => f.conta).join(', ').slice(0, TETO_DO_DETALHE)
        );
      }
      if (primeira) url.searchParams.set('primeira', '1');
      return semCookie(NextResponse.redirect(url));
    } catch (err) {
      if (err instanceof InstagramApiError) {
        console.warn('[cb/instagram/oauth] a Meta recusou (unificado):', err.codigo, err.message);
        return voltar('meta', err.message);
      }
      console.error('[cb/instagram/oauth] falha inesperada (unificado):', err instanceof Error ? err.message : err);
      return voltar('erro');
    }
  }

  // ---- Login do Instagram (app antigo) ----
  try {
    const curto = await trocarCodigoPorToken({
      appId: app.appId,
      appSecret: app.appSecret,
      redirectUri: urlDeRedirecionamento(origem),
      code,
    });
    // "Não concedeu" é recusa; "a Meta não disse" segue (a conexão morre
    // visível no primeiro envio, não num beco sem saída aqui).
    if (curto.permissoes === null) {
      console.warn('[cb/instagram/oauth] a troca do código veio sem `permissions`');
    } else if (!curto.permissoes.includes(PERMISSAO_DE_MENSAGENS)) {
      return voltar('permissao');
    }
    const longo = await trocarPorTokenLongo({ appSecret: app.appSecret, token: curto.token });
    const cliente = criarClienteInstagram(longo.token);
    const perfil = await cliente.me();
    // Falha na gravação DEPOIS daqui deixa a conta assinada sem canal: as
    // entregas chegam, não casam conexão nenhuma e são descartadas com log
    // (ruído, não vazamento). Reconectar assina de novo e resolve.
    await cliente.assinarWebhooks(CAMPOS_DO_WEBHOOK);

    // O webhook no painel da Meta é configurado UMA vez por app: a tela só
    // abre o diálogo dele para a PRIMEIRA conexão de Instagram da conta.
    // Leitura que falha conta como "não é a primeira": abrir o diálogo à toa
    // afirma "nada chega até você fazer isto" sobre webhook já configurado.
    // Só as conexões DESTE login: o webhook do unificado é outro (M1).
    const { count, error: erroDaContagem } = await ctx.supabase
      .from('cb_channels')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('kind', 'instagram')
      .eq('ig_login', 'instagram');
    const primeira = !erroDaContagem && (count ?? 0) === 0;

    const r = await gravarCanalDoInstagram(ctx.supabase, {
      accountId: ctx.accountId,
      userId: ctx.userId,
      // `null` = nasce como `@username`; reconectar preserva o que o
      // operador deu em "Configurar".
      label: null,
      accessToken: longo.token,
      igAppSecret: app.appSecret,
      humanAgent: null,
      perfil,
      tokenExpiraEm: vencimentoDoToken(longo.expiraEmSeg),
      login: 'instagram',
      clientBusinessId: null,
    });
    if (!r.ok) {
      return r.codigo === 'outra_conta'
        ? voltar('outra_conta', `@${perfil.username}`)
        : voltar('erro');
    }

    const url = new URL('/settings', origem);
    url.searchParams.set('tab', 'channels');
    url.searchParams.set('instagram', 'conectado');
    url.searchParams.set('canal', r.canal.id);
    url.searchParams.set('username', perfil.username);
    if (primeira && !r.reconectado) url.searchParams.set('primeira', '1');
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
