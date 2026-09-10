// ============================================================
// /api/cb/instagram/oauth/start — o começo do login do Instagram. Admin+.
//
// Monta o `state` assinado (conta + membro + nonce + validade), guarda o
// nonce num cookie HttpOnly e manda a pessoa para a página de autorização
// do Instagram. Qualquer coisa que impeça isso volta para Conexões com
// `?instagram=erro&motivo=…` — é um clique de navegador, não um fetch, então
// JSON aqui não teria quem o lesse.
// ============================================================

import { NextResponse, type NextRequest } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ForbiddenError, UnauthorizedError, requireRole } from '@/lib/auth/account';
import {
  checkRateLimit,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { lerAppDoInstagram } from '@/lib/instagram/app';
import type { MotivoDoOAuth } from '@/lib/instagram/conexao';
import {
  COOKIE_DO_OAUTH,
  VALIDADE_DO_ESTADO_MS,
  criarEstado,
  novoNonce,
  origemDoPedido,
  urlDeAutorizacao,
  urlDeRedirecionamento,
} from '@/lib/instagram/oauth';

/** Repetida no callback de propósito: route.ts só pode exportar handlers. */
function motivoDaFalhaDeAcesso(err: unknown): MotivoDoOAuth {
  if (err instanceof UnauthorizedError) return 'sessao';
  if (err instanceof ForbiddenError) return 'sem_permissao';
  return 'erro';
}

export async function GET(request: NextRequest) {
  const origem = origemDoPedido(request);
  const voltar = (motivo: MotivoDoOAuth) => {
    const url = new URL('/settings', origem);
    url.searchParams.set('tab', 'channels');
    url.searchParams.set('instagram', 'erro');
    url.searchParams.set('motivo', motivo);
    return NextResponse.redirect(url);
  };

  let ctx;
  try {
    ctx = await requireRole('admin');
  } catch (err) {
    // Sem sessão o middleware já mandaria para o login; quem tem sessão e
    // não é admin precisa ouvir que é o PERFIL, não a sessão; o resto é
    // falha nossa (perfil que não carregou).
    return voltar(motivoDaFalhaDeAcesso(err));
  }
  const limit = checkRateLimit(`cb:igOauth:${ctx.userId}`, RATE_LIMITS.adminAction);
  if (!limit.success) return voltar('limite');

  let app;
  try {
    app = await lerAppDoInstagram(supabaseAdmin(), ctx.accountId);
  } catch (err) {
    console.error('[cb/instagram/oauth] app ilegível:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
  if (!app) return voltar('sem_app');

  const nonce = novoNonce();
  let estado: string;
  try {
    estado = criarEstado({ accountId: ctx.accountId, userId: ctx.userId, nonce });
  } catch (err) {
    // ENCRYPTION_KEY ausente ou curta (o `crm.env` que não foi carregado):
    // volta com motivo, não com a página 500 crua do Next.
    console.error('[cb/instagram/oauth] sem chave para o state:', err instanceof Error ? err.message : err);
    return voltar('erro');
  }
  const resposta = NextResponse.redirect(
    urlDeAutorizacao({
      appId: app.appId,
      redirectUri: urlDeRedirecionamento(origem),
      estado,
    }),
  );
  resposta.cookies.set({
    name: COOKIE_DO_OAUTH,
    value: nonce,
    httpOnly: true,
    sameSite: 'lax',
    secure: origem.startsWith('https://'),
    path: '/api/cb/instagram/oauth',
    maxAge: Math.floor(VALIDADE_DO_ESTADO_MS / 1000),
  });
  return resposta;
}
