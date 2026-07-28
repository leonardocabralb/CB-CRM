// ============================================================
// POST /api/cb/groups/sync   body: { channel_id }
//
// Descobre os grupos de um canal e preenche o cadastro.
//
// A resposta volta assim que a parte RÁPIDA termina (um `findChats`, poucos
// segundos, já com nome e foto de cada grupo). O detalhamento — participantes,
// announce, admin, nosso LID — custa ~850ms por grupo e roda em `after()`:
// com 57 grupos são ~48s, tempo que nenhum operador espera de pé olhando um
// botão girar.
//
// Consequência visível e aceita: logo após sincronizar, a lista já está certa
// mas o painel de um grupo pode dizer "ainda não sei" sobre admin/participantes
// por alguns segundos.
// ============================================================

import { NextResponse, after } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getChannelWithSecrets } from '@/lib/cb-channels/repo';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { detalharGrupos, sincronizarListaDeGrupos } from '@/lib/cb-groups/sync';
import { createClient } from '@supabase/supabase-js';

// O detalhamento roda dentro deste orçamento; ver o comentário do módulo.
export const maxDuration = 120;

/**
 * O `after()` sobrevive à resposta, e o client RLS do pedido não: ele nasce
 * das credenciais da requisição, que já terminou. Por isso o trabalho de fundo
 * usa service-role — e todo filtro abaixo carrega `account_id` explicitamente.
 */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`cb:groupsSync:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { channel_id?: unknown } | null;
    const channelId = typeof body?.channel_id === 'string' ? body.channel_id : '';
    if (!channelId) {
      return NextResponse.json({ error: 'channel_id é obrigatório.' }, { status: 400 });
    }

    const canal = await getChannelWithSecrets(ctx.supabase, ctx.accountId, channelId);
    if (!canal) {
      return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
    }
    if (canal.kind !== 'evolution') {
      // Grupo não existe na API oficial da Meta — não é limitação nossa.
      return NextResponse.json(
        { error: 'Grupos só funcionam em conexões por QR Code, não na API oficial da Meta.' },
        { status: 400 },
      );
    }
    if (!canal.server_url || !canal.instance_name || !canal.api_key) {
      return NextResponse.json(
        { error: 'Conexão incompleta — reconecte o WhatsApp em Configurações.' },
        { status: 400 },
      );
    }

    const client = new EvolutionClient({
      baseUrl: canal.server_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });

    const { grupos, gravados } = await sincronizarListaDeGrupos(admin(), {
      accountId: ctx.accountId,
      channelId,
      client,
    });

    const jids = grupos.map((g) => g.jid);
    const displayPhone = canal.display_phone ?? null;
    const ownLidConhecido = (canal as { own_lid?: string | null }).own_lid ?? null;

    after(async () => {
      try {
        await detalharGrupos(admin(), {
          accountId: ctx.accountId,
          channelId,
          client,
          displayPhone,
          jids,
          ownLidConhecido,
        });
      } catch (err) {
        // A lista já está gravada; aqui só se perde o detalhe, e o operador
        // pode mandar sincronizar de novo.
        console.error('[cb/groups/sync] detalhamento falhou:', err);
      }
    });

    return NextResponse.json({
      encontrados: grupos.length,
      gravados,
      // A UI usa isto para dizer "detalhes chegando" em vez de fingir que
      // terminou tudo.
      detalhando: jids.length,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
