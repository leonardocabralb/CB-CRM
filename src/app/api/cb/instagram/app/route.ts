// ============================================================
// /api/cb/instagram/app — o app da Meta da conta (990). Admin+.
//
//   GET — está cadastrado? de que tipo (login do Instagram ou unificado)?
//         qual App ID e ID da configuração? e a URI de retorno que o painel
//         da Meta precisa conhecer (derivada do pedido, como o callback a
//         deriva). O segredo NÃO sai daqui, nem mascarado. Com a central do
//         Instagram no ambiente (U-3), `central: true` e app nenhum.
//   PUT — cadastra ou troca: `login` (`instagram`, o padrão, ou
//         `unificado`), `app_id` (só dígitos), `config_id` (só no unificado)
//         e `app_secret` (obrigatório no primeiro cadastro e ao TROCAR o tipo
//         do app; vazio depois = mantém o guardado).
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
  CONFIG_ID_VALIDO,
  gravarAppDoInstagram,
  lerAppDoInstagram,
  loginDoApp,
} from '@/lib/instagram/app';
import { estadoDoCliente } from '@/lib/instagram/central/cliente';
import { origemDoPedido, urlDeRedirecionamento } from '@/lib/instagram/oauth';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:igApp:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    // Pela central (U-3), o app é o da Atlas: a tela não pede app nenhum, e o
    // app antigo da conta nem é lido (um segredo que não decifra mais, depois
    // de uma troca de chave, não pode tirar o botão de conectar).
    const central = estadoDoCliente();
    if (central.ligado && central.incompleto === null) {
      return NextResponse.json({
        central: true,
        configurado: false,
        login: null,
        appId: null,
        configId: null,
        atualizadoEm: null,
        redirectUri: urlDeRedirecionamento(origemDoPedido(request)),
      });
    }
    let app;
    try {
      app = await lerAppDoInstagram(supabaseAdmin(), ctx.accountId);
    } catch (err) {
      console.error('[cb/instagram/app] leitura falhou:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Não foi possível ler o app da Meta.' }, { status: 500 });
    }
    return NextResponse.json({
      central: false,
      configurado: app !== null,
      login: app?.login ?? null,
      appId: app?.appId ?? null,
      configId: app?.configId ?? null,
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
    // Sem `login` = o app antigo, como a tela anterior à 1153 mandava.
    const login = body?.login === undefined ? 'instagram' : loginDoApp(body.login);
    if (!login) {
      return NextResponse.json({ error: 'Tipo de app desconhecido.' }, { status: 400 });
    }
    const unificado = login === 'unificado';
    const appId = typeof body?.app_id === 'string' ? body.app_id.trim() : '';
    const appSecret = typeof body?.app_secret === 'string' ? body.app_secret.trim() : '';
    const configId = typeof body?.config_id === 'string' ? body.config_id.trim() : '';
    if (!APP_ID_VALIDO.test(appId)) {
      return NextResponse.json(
        {
          error: unificado
            ? 'O App ID é o número em "ID do app", em Configurações do app → Básico.'
            : 'O Instagram App ID é o número em "ID do app do Instagram", no alto da tela de configuração do Instagram.',
        },
        { status: 400 },
      );
    }
    if (unificado && !CONFIG_ID_VALIDO.test(configId)) {
      return NextResponse.json(
        { error: 'O ID da configuração é o número em "Identificação da configuração", na aba do login unificado do caso de uso do Instagram.' },
        { status: 400 },
      );
    }

    let resultado: Awaited<ReturnType<typeof gravarAppDoInstagram>>;
    try {
      resultado = await gravarAppDoInstagram(supabaseAdmin(), {
        accountId: ctx.accountId,
        userId: ctx.userId,
        login,
        appId,
        appSecret: appSecret || null,
        configId: unificado ? configId : null,
      });
    } catch (err) {
      console.error('[cb/instagram/app] gravação falhou:', err instanceof Error ? err.message : err);
      return NextResponse.json({ error: 'Não foi possível salvar o app da Meta.' }, { status: 500 });
    }
    if (resultado === 'sem_app') {
      // Primeiro cadastro, ou troca do tipo do app: o segredo guardado é do
      // OUTRO login e não serve.
      return NextResponse.json(
        {
          error: unificado
            ? 'Informe o App Secret (Configurações do app → Básico → Chave secreta do aplicativo).'
            : 'Informe o Instagram App Secret.',
        },
        { status: 400 },
      );
    }
    return NextResponse.json({
      configurado: true,
      login,
      appId,
      configId: unificado ? configId : null,
      redirectUri: urlDeRedirecionamento(origemDoPedido(request)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
