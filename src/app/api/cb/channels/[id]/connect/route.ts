// ============================================================
// POST /api/cb/channels/[id]/connect
//
// Devolve o QR atual OU confirma que a conexão abriu. A UI chama em laço
// enquanto a tela do QR está aberta (o QR da Evolution expira a cada ~45s
// e é regenerado sozinho). Quando conecta, grava o número pareado em
// `cb_channels.display_phone`.
//
// É POST porque tem efeito: quando a instância está fechada, consultar
// dispara a reconexão do lado da Evolution.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  getChannelWithSecrets,
  CB_CHANNEL_SAFE_COLUMNS,
} from '@/lib/cb-channels/repo';
import { channelConnectionState } from '@/lib/cb-channels/evolution-admin';

/** A UI faz polling enquanto o QR está na tela (~12/min a 5s). 60/min dá
 *  folga para recarregar e para dois admins pareando ao mesmo tempo. */
const CONNECT_LIMIT = { limit: 60, windowMs: 60_000 };

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');

    const limit = checkRateLimit(`cb:channelConnect:${ctx.userId}`, CONNECT_LIMIT);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const channel = await getChannelWithSecrets(ctx.supabase, ctx.accountId, id);
    if (!channel) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }
    if (channel.kind !== 'evolution') {
      return NextResponse.json(
        { error: 'Só canais da Evolution são pareados por QR Code.' },
        { status: 400 },
      );
    }
    if (!channel.instance_name) {
      return NextResponse.json(
        { error: 'Canal Evolution sem instância — recrie o canal.' },
        { status: 400 },
      );
    }

    let res;
    try {
      res = await channelConnectionState(channel.instance_name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return NextResponse.json({ error: `Erro da Evolution: ${message}` }, { status: 502 });
    }

    if (res.state !== 'open') {
      if (channel.status !== 'connecting') {
        await ctx.supabase
          .from('cb_channels')
          .update({ status: 'connecting', last_error: null })
          .eq('id', channel.id)
          .eq('account_id', ctx.accountId);
      }
      return NextResponse.json({ connected: false, qr: res.qrBase64 ?? null });
    }

    // Conectou.
    const { data: updated, error } = await ctx.supabase
      .from('cb_channels')
      .update({
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_error: null,
        ...(res.ownerPhone ? { display_phone: res.ownerPhone } : {}),
      })
      .eq('id', channel.id)
      .eq('account_id', ctx.accountId)
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .single();

    if (error) {
      console.error('[cb/channels/connect] update falhou:', error.message);
      return NextResponse.json(
        { error: 'O número conectou, mas falhou ao salvar o estado.' },
        { status: 500 },
      );
    }

    // Se este canal é o padrão, mantém o espelho whatsapp_config em sincronia.
    if (channel.is_default) {
      await ctx.supabase
        .from('whatsapp_config')
        .update({
          instance_state: 'open',
          status: 'connected',
          connected_at: new Date().toISOString(),
          last_connected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId);
    }

    return NextResponse.json({ connected: true, qr: null, channel: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
