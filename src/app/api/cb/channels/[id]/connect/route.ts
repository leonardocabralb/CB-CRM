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
import {
  channelConnectionState,
  reaplicarWebhook,
} from '@/lib/cb-channels/evolution-admin';

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

    // REAPLICA O WEBHOOK antes de consultar o estado.
    //
    // A Evolution congela a lista de eventos no momento em que o webhook é
    // registrado. Quando o CRM passa a assinar um evento novo, a instância
    // JÁ EXISTENTE continua sem recebê-lo — foi assim que `MESSAGES_DELETE`
    // e `MESSAGES_EDITED` ficaram sem chegar: a exclusão feita pelo cliente
    // simplesmente não era avisada, e a mensagem seguia intacta no CRM.
    //
    // Antes disto o único caminho que registrava webhook era a CRIAÇÃO do
    // canal — ou seja, só um canal novo ganhava eventos novos. Reconectar é
    // o gesto natural para "consertar a conexão", então é aqui que a
    // reparação pertence.
    //
    // Best-effort de propósito: falhar aqui não pode impedir o operador de
    // ver o QR e reconectar.
    //
    // ⚠️ Mas a falha VOLTA na resposta, em vez de morrer num console que
    // ninguém lê. Este é o único caminho que conserta a assinatura de
    // eventos, e o operador precisa saber quando ele não pegou — senão a
    // exclusão feita pelo cliente segue invisível e ninguém descobre.
    let webhookError: string | null = null;
    try {
      await reaplicarWebhook(channel.instance_name, new URL(_request.url).origin);
    } catch (err) {
      webhookError = err instanceof Error ? err.message : String(err);
      console.warn('[cb/channels/connect] não foi possível reaplicar o webhook:', webhookError);
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
      return NextResponse.json({ connected: false, qr: res.qrBase64 ?? null, webhookError });
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

    return NextResponse.json({ connected: true, qr: null, channel: updated, webhookError });
  } catch (err) {
    return toErrorResponse(err);
  }
}
