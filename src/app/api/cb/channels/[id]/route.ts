// ============================================================
// /api/cb/channels/[id]
//
//   PATCH  — renomear o canal.
//   DELETE — remover o canal (e sua instância no servidor Evolution).
//
// Ambos admin+. O canal PADRÃO não pode ser excluído aqui (é o espelho de
// whatsapp_config que o código herdado lê) — promova outro canal primeiro,
// via POST /api/cb/channels/[id]/default.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import {
  getChannelWithSecrets,
  CB_CHANNEL_SAFE_COLUMNS,
} from '@/lib/cb-channels/repo';
import { deleteChannelInstance } from '@/lib/cb-channels/evolution-admin';

const MAX_LABEL_LEN = 60;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:channelUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { label?: unknown } | null;
    const label = typeof body?.label === 'string' ? body.label.trim() : '';

    if (!label) {
      return NextResponse.json({ error: 'O nome do canal não pode ficar vazio.' }, { status: 400 });
    }
    if (label.length > MAX_LABEL_LEN) {
      return NextResponse.json(
        { error: `O nome do canal deve ter no máximo ${MAX_LABEL_LEN} caracteres.` },
        { status: 400 },
      );
    }

    const { data, error } = await ctx.supabase
      .from('cb_channels')
      .update({ label })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[cb/channels PATCH] erro:', error.message);
      return NextResponse.json({ error: 'Falha ao atualizar o canal.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }
    return NextResponse.json({ channel: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:channelDelete:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const channel = await getChannelWithSecrets(ctx.supabase, ctx.accountId, id);
    if (!channel) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }
    if (channel.is_default) {
      return NextResponse.json(
        { error: 'O canal padrão não pode ser removido. Torne outro canal o padrão primeiro.' },
        { status: 400 },
      );
    }

    // Remove a instância no servidor ANTES de apagar a linha (depois
    // perderíamos as credenciais). Erros são engolidos na função.
    if (channel.kind === 'evolution' && channel.instance_name) {
      await deleteChannelInstance(channel.instance_name);
    }

    // Solta o pino ANTES de apagar. A FK é ON DELETE SET NULL, então depois do
    // delete a conversa fica com channel_id=NULL e channel_pinned=true — um
    // estado morto: followConversationChannel só move conversa com
    // channel_pinned=false, então ela nunca mais seria apontada para nenhum
    // canal. Depois do delete também não daria para encontrá-las (o
    // channel_id já teria virado NULL). Best-effort: não bloqueia a remoção.
    const { error: unpinError } = await ctx.supabase
      .from('conversations')
      .update({ channel_pinned: false })
      .eq('channel_id', id)
      .eq('account_id', ctx.accountId);
    if (unpinError) {
      console.warn(
        '[cb/channels DELETE] falha ao soltar o pino das conversas:',
        unpinError.message,
      );
    }

    const { error } = await ctx.supabase
      .from('cb_channels')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);

    if (error) {
      console.error('[cb/channels DELETE] erro:', error.message);
      return NextResponse.json({ error: 'Falha ao remover o canal.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
