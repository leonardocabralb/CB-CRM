// ============================================================
// /api/cb/instagram/app — o app da Meta da conta (990). Admin+.
//
//   GET — está cadastrado? qual App ID? e a URI de retorno que o painel da
//         Meta precisa conhecer (derivada do pedido, como o callback a
//         deriva). O segredo NÃO sai daqui, nem mascarado.
//   PUT — cadastra ou troca: `app_id` (só dígitos) e `app_secret`
//         (obrigatório no primeiro cadastro; vazio depois = mantém o
//         guardado, para trocar só o App ID sem digitar o segredo de novo).
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  APP_ID_VALIDO,
  gravarAppDoInstagram,
  lerAppDoInstagram,
} from '@/lib/instagram/app';
import { origemDoPedido, urlDeRedirecionamento } from '@/lib/instagram/oauth';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:igApp:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    let app;
    try {
      app = await lerAppDoInstagram(supabaseAdmin(), ctx.accountId);
    } catch (err) {
      console.error('[cb/instagram/app] leitura falhou:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Não foi possível ler o app da Meta.' }, { status: 500 });
    }
    return NextResponse.json({
      configurado: app !== null,
      appId: app?.appId ?? null,
      atualizadoEm: app?.atualizadoEm ?? null,
      redirectUri: urlDeRedirecionamento(origemDoPedido(request)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:igApp:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const appId = typeof body?.app_id === 'string' ? body.app_id.trim() : '';
    const appSecret = typeof body?.app_secret === 'string' ? body.app_secret.trim() : '';
    if (!APP_ID_VALIDO.test(appId)) {
      return NextResponse.json(
        { error: 'O Instagram App ID é o número mostrado na aba do produto Instagram.' },
        { status: 400 },
      );
    }

    let resultado: Awaited<ReturnType<typeof gravarAppDoInstagram>>;
    try {
      resultado = await gravarAppDoInstagram(supabaseAdmin(), {
        accountId: ctx.accountId,
        userId: ctx.userId,
        appId,
        appSecret: appSecret || null,
      });
    } catch (err) {
      console.error('[cb/instagram/app] gravação falhou:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Não foi possível salvar o app da Meta.' }, { status: 500 });
    }
    if (resultado === 'sem_app') {
      return NextResponse.json({ error: 'Informe o Instagram App Secret.' }, { status: 400 });
    }
    return NextResponse.json({
      configurado: true,
      appId,
      redirectUri: urlDeRedirecionamento(origemDoPedido(request)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
