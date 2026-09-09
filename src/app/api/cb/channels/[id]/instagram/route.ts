// ============================================================
// /api/cb/channels/[id]/instagram — o que só a conexão do Instagram tem.
//
//   GET  — o verify token (em claro) e a identidade da conta, para o
//          operador configurar o webhook no painel da Meta. Admin+.
//   POST — token novo colado (o de 60 dias do painel). Confere no `/me`
//          que é a MESMA conta antes de gravar. Admin+.
//
// O verify token sai daqui de propósito: ele fica CIFRADO em `verify_token`
// (fora de CB_CHANNEL_SAFE_COLUMNS) e a Meta o pede uma vez, na
// configuração — mas o operador pode perdê-lo, reconfigurar o app ou trocar
// de app. Sem esta rota, a única saída seria apagar e recriar a conexão, e
// com ela o `channel_id` de toda mensagem do Direct.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  CB_CHANNEL_SAFE_COLUMNS,
  getChannelWithSecrets,
} from '@/lib/cb-channels/repo';
import { ehInstagram } from '@/lib/cb-channels/transporte';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { criarClienteInstagram } from '@/lib/instagram/graph';
import { validadeDoToken } from '@/lib/instagram/conexao';

type Ctx = Awaited<ReturnType<typeof requireRole>>;

/** A conexão do Instagram desta conta, ou a resposta de erro. */
async function conexaoDoInstagram(ctx: Ctx, id: string) {
  const canal = await getChannelWithSecrets(ctx.supabase, ctx.accountId, id);
  if (!canal || !ehInstagram(canal)) {
    return {
      erro: NextResponse.json(
        { error: 'Conexão do Instagram não encontrada.' },
        { status: 404 }
      ),
    };
  }
  return { canal };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `cb:igWebhook:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const r = await conexaoDoInstagram(ctx, id);
    if ('erro' in r) return r.erro;

    return NextResponse.json({
      verifyToken: r.canal.verify_token ? decrypt(r.canal.verify_token) : null,
      igUserId: r.canal.ig_user_id,
      igUsername: r.canal.ig_username,
      tokenExpiresAt: r.canal.ig_token_expires_at,
      humanAgent: r.canal.ig_human_agent,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `cb:igToken:${ctx.userId}`,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      access_token?: unknown;
    } | null;
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : '';
    if (!accessToken) {
      return NextResponse.json(
        { error: 'Cole o token novo gerado no painel da Meta.' },
        { status: 400 }
      );
    }

    const r = await conexaoDoInstagram(ctx, id);
    if ('erro' in r) return r.erro;
    const { canal } = r;

    // O `/me` do token novo diz de QUAL conta ele é. Gravar o token de outra
    // conta trocaria a identidade da conexão sem ninguém perceber — e o
    // webhook continuaria chegando pelo `ig_user_id` antigo.
    let perfil;
    try {
      perfil = await criarClienteInstagram(accessToken).me();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return NextResponse.json(
        { error: `Erro do Instagram: ${message}` },
        { status: 400 }
      );
    }
    if (perfil.igUserId !== canal.ig_user_id) {
      return NextResponse.json(
        {
          error: `Este token é da conta @${perfil.username}, não de @${canal.ig_username ?? canal.ig_user_id}.`,
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const { data, error } = await ctx.supabase
      .from('cb_channels')
      .update({
        access_token: encrypt(accessToken),
        // O @ pode ter mudado desde o cadastro; o /me é a fonte.
        ig_username: perfil.username,
        ig_token_expires_at: validadeDoToken(),
        ig_token_refreshed_at: nowIso,
        status: 'connected',
        connected_at: canal.connected_at ?? nowIso,
        last_error: null,
      })
      .eq('id', canal.id)
      .eq('account_id', ctx.accountId)
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .maybeSingle();

    if (error || !data) {
      console.error(
        '[cb/channels instagram] renovação falhou:',
        error?.message
      );
      return NextResponse.json(
        { error: 'Não foi possível gravar o token novo.' },
        { status: 500 }
      );
    }
    return NextResponse.json({ channel: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
