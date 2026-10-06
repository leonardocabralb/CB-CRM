// ============================================================
// POST /api/cb/channels/[id]/connect
//
// Devolve o QR atual OU confirma que a conexão abriu. A UI chama em laço
// enquanto a tela do QR está aberta (o QR da Evolution expira a cada ~45s
// e é regenerado sozinho). Quando conecta, grava o número pareado em
// `cb_channels.display_phone`.
//
// É POST porque tem efeito: com a instância fechada CONFIRMADA (lida
// 'close' duas vezes, com `ESPERA_FECHADA_MS` entre as leituras), consultar
// pede o QR, e a Evolution abre uma sessão nova. Fechada por um instante é
// a Evolution reconectando sozinha, e um pedido ali duplicava a sessão
// (`evolution-admin.ts`).
//
// Corpo opcional `{ reaplicarWebhook?: boolean }`: só `false` pula a
// reaplicação do webhook. Sem corpo, ou corpo inválido, reaplica — é o que
// faz a tela aberta antes do deploy, que não manda corpo.
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
import { ehEvolution } from '@/lib/cb-channels/transporte';
import { trocouDeNumero } from '@/lib/cb-channels/troca-de-numero';

/** A UI faz polling enquanto o QR está na tela (~12/min a 5s). 60/min dá
 *  folga para recarregar e para dois admins pareando ao mesmo tempo. */
const CONNECT_LIMIT = { limit: 60, windowMs: 60_000 };

/**
 * De qual endereço o operador clicou.
 *
 * ⚠️ NÃO use `new URL(request.url).origin` para isto. O servidor standalone
 * do Next escuta em `HOSTNAME=0.0.0.0` (Dockerfile), e é isso que aparece
 * ali: em produção o valor é `http://0.0.0.0:3000`, nunca o domínio público.
 * A guarda de reaplicação do webhook usa esta origem para distinguir "a
 * produção reaplicando a si mesma" de "uma máquina de fora mexendo no webhook
 * dela" — com `0.0.0.0` a distinção nunca acontecia.
 *
 * O Traefik publica o serviço com `passHostHeader=true` (docker-stack.yml),
 * então o `Host` real chega intacto. Mesma abordagem que
 * `src/app/api/account/invitations/route.ts` já usava para montar links.
 */
function origemDoPedido(request: Request): string | undefined {
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    request.headers.get('host')?.trim();
  if (!host) return undefined;
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || 'https';
  return `${proto}://${host}`;
}

/** Só `{ reaplicarWebhook: false }` desliga; o resto (sem corpo, inválido) reaplica. */
async function querReaplicarWebhook(request: Request): Promise<boolean> {
  try {
    const corpo = (await request.json()) as { reaplicarWebhook?: unknown } | null;
    return corpo?.reaplicarWebhook !== false;
  } catch {
    return true;
  }
}

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
    if (!ehEvolution(channel)) {
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
    //
    // UMA vez por abertura do diálogo do QR (a primeira consulta manda
    // `true`, as seguintes `false`) e no "Ressincronizar": antes, eram 12
    // `webhook/set` por minuto com o diálogo aberto.
    let webhookError: string | null = null;
    if (await querReaplicarWebhook(_request)) {
      try {
        await reaplicarWebhook(channel.instance_name, origemDoPedido(_request));
      } catch (err) {
        webhookError = err instanceof Error ? err.message : String(err);
        console.warn('[cb/channels/connect] não foi possível reaplicar o webhook:', webhookError);
      }
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

    // Conectou. Com OUTRO chip (o "Reparear" é o caminho para trocar o
    // número), o LID do aparelho velho sai junto e é reaprendido — ver
    // `troca-de-numero.ts`.
    //
    // ⚠️ `numeroPendente`: aberta, mas a Evolution ainda não gravou o número
    // do pareamento novo (o `ownerJid` dela é o do chip ANTERIOR por alguns
    // segundos). O status vira `connected` (é verdade), o número NÃO é
    // gravado (seria o velho) e a resposta pede à tela que consulte de novo.
    // O aviso `connection.update` também grava o número
    // (`registrarNumeroDoAviso`).
    const trocou = trocouDeNumero(channel.display_phone, res.ownerPhone);
    const { data: updated, error } = await ctx.supabase
      .from('cb_channels')
      .update({
        status: 'connected',
        connected_at: new Date().toISOString(),
        last_error: null,
        ...(res.ownerPhone ? { display_phone: res.ownerPhone } : {}),
        ...(trocou ? { own_lid: null } : {}),
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

    if (res.numeroPendente) {
      return NextResponse.json({ connected: false, qr: null, numeroPendente: true, webhookError });
    }

    // O número de antes, quando havia um e mudou: a tela confirma a troca.
    const numeroAnterior = trocou && channel.display_phone ? channel.display_phone : null;
    return NextResponse.json({ connected: true, qr: null, channel: updated, webhookError, numeroAnterior });
  } catch (err) {
    return toErrorResponse(err);
  }
}
