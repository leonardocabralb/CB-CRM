// ============================================================
// POST /api/cb/channels/[id]/fotos — busca em lote a foto de perfil dos
// contatos desta conexão (pedido do operador, 2026-09-03).
//
// Uma chamada a `chat/findChats` traz a foto de todos os chats; o casamento
// com `contacts` e a cópia para o Storage estão em
// `lib/whatsapp/foto-do-contato`. Roda em `after()`: são até ~200 downloads
// sequenciais e a resposta volta na hora (202) — o operador vê as fotos
// entrando na lista nos minutos seguintes.
//
// Admin+: mexe na ficha de todos os contatos da conta.
// ============================================================

import { NextResponse, after } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { getChannelWithSecrets } from '@/lib/cb-channels/repo';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { decrypt } from '@/lib/whatsapp/encryption';
import { conferirFotosDaConexao } from '@/lib/whatsapp/foto-do-contato';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';

/**
 * Lotes EM CURSO, por conexão (achado do Codex no PR #110): a rota responde
 * 202 na hora e o botão volta a aceitar clique, então dois cliques seguidos
 * baixavam as mesmas centenas de fotos em paralelo. Enquanto o lote roda, a
 * conexão responde 409. ⚠️ É memória de PROCESSO — no deploy (`start-first`)
 * há dois Node vivos por instantes, e cada um tem o seu conjunto; é a mesma
 * régua do rate limit em `lib/rate-limit`, e o dano do caso raro é só
 * trabalho repetido (o upload é `upsert`).
 */
const lotesEmCurso = new Set<string>();

/** O `after()` sobrevive à resposta; o client RLS do pedido, não. */
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:fotos:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id: channelId } = await params;
    const body = (await request.json().catch(() => null)) as { forcar?: unknown } | null;
    const forcar = body?.forcar === true;

    const canal = await getChannelWithSecrets(ctx.supabase, ctx.accountId, channelId);
    if (!canal) {
      return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 });
    }
    if (canal.kind !== 'evolution') {
      return NextResponse.json(
        { error: 'Foto de perfil só está disponível em conexões por QR Code.' },
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
    const accountId = ctx.accountId;

    if (lotesEmCurso.has(channelId)) {
      return NextResponse.json(
        { error: 'Já há uma busca de fotos em andamento nesta conexão.', code: 'busca_em_curso' },
        { status: 409 },
      );
    }
    lotesEmCurso.add(channelId);

    after(async () => {
      try {
        const resumo = await conferirFotosDaConexao({ db: admin(), client, accountId, forcar });
        console.log(
          `[cb/channels/fotos] conexão ${channelId}: ${resumo.chatsComFoto} chats com foto, ${resumo.candidatos} candidatos, ${resumo.atualizadas} atualizadas, ${resumo.falhas} falhas`,
        );
      } catch (err) {
        console.error('[cb/channels/fotos] lote falhou:', err instanceof Error ? err.message : err);
      } finally {
        lotesEmCurso.delete(channelId);
      }
    });

    return NextResponse.json({ started: true }, { status: 202 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
