// ============================================================
// POST /api/cb/channels/[id]/restart — REPAREAR a conexão
//
// O degrau acima de "Ressincronizar" (POST /[id]/connect), e existe porque
// aquele não alcança o caso que o operador mais sofre: a instância zumbi.
// `channelConnectionState` retorna cedo quando a Evolution responde 'open'
// (evolution-admin.ts), então uma instância que se diz conectada e não
// entrega nada só é CONFIRMADA — o estado mentiroso é inclusive regravado no
// banco. Aqui o ciclo é forçado: logout → QR novo.
//
// Custo, dito em voz alta na UI antes de chamar: o número fica MUDO até
// alguém escanear o QR no celular. Nada se perde no CRM — `logout` não toca
// no Postgres, e conversas, mensagens, contatos, o funil padrão e a própria
// linha do canal ficam intactos.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import {
  getChannelWithSecrets,
  CB_CHANNEL_SAFE_COLUMNS,
} from '@/lib/cb-channels/repo';
import { repairChannelPairing } from '@/lib/cb-channels/evolution-admin';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:channelRestart:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const channel = await getChannelWithSecrets(ctx.supabase, ctx.accountId, id);
    if (!channel) {
      return NextResponse.json({ error: 'Canal não encontrado.' }, { status: 404 });
    }
    if (channel.kind !== 'evolution') {
      // Canal Meta não tem sessão de QR para derrubar. O equivalente é
      // revalidar a credencial (verify → register → subscribe), que é o
      // assistente de conexão — não este endpoint.
      return NextResponse.json(
        {
          error:
            'Números da API oficial da Meta não usam QR Code. Para revalidar a credencial, refaça a conexão pelo assistente.',
        },
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
      res = await repairChannelPairing(channel.instance_name);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      return NextResponse.json({ error: `Erro da Evolution: ${message}` }, { status: 502 });
    }

    // 'connecting' é a verdade, não um chute otimista: o logout REALMENTE
    // derrubou a sessão, então o número está fora do ar até alguém escanear.
    // Se o operador desistir do QR, o canal fica em 'connecting' — e é
    // exatamente o que ele é.
    const { data: updated, error } = await ctx.supabase
      .from('cb_channels')
      .update({ status: 'connecting', last_error: null })
      .eq('id', channel.id)
      .eq('account_id', ctx.accountId)
      .select(CB_CHANNEL_SAFE_COLUMNS)
      .maybeSingle();

    if (error) {
      console.error('[cb/channels/restart] update falhou:', error.message);
      // A sessão JÁ caiu — esconder isso deixaria a tela mostrando
      // "conectado" sobre um número que não recebe mais nada.
      return NextResponse.json(
        { error: 'A sessão foi derrubada, mas falhou ao salvar o estado. Recarregue a página.' },
        { status: 500 },
      );
    }

    // Espelho do canal padrão, para o código herdado não seguir achando que
    // o número está de pé.
    if (channel.is_default) {
      await ctx.supabase
        .from('whatsapp_config')
        .update({
          instance_state: 'connecting',
          status: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId);
    }

    return NextResponse.json({
      qr: res.qrBase64 ?? null,
      pairingCode: res.pairingCode ?? null,
      channel: updated,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
