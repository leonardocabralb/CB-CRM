// ============================================================
// POST /api/cb/groups/media/[messageId]
//
// O "toque para baixar" dos anexos de grupo que não vieram na chegada
// (acima de 5 MB, ou cujo download falhou).
//
// ⚠️ ISTO PODE FALHAR PARA SEMPRE, e o erro precisa dizer isso. O WhatsApp
// expira a mídia no servidor dele; passado o prazo, o arquivo não existe mais
// em lugar nenhum e nenhuma tentativa vai trazê-lo. "Tente de novo mais
// tarde" seria mentira cruel — o operador tentaria por dias.
// ============================================================

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveChannelForConversation } from '@/lib/cb-channels/resolve';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { fetchAndStoreEvolutionMedia } from '@/lib/whatsapp/transport/evolution-media';
import { decrypt } from '@/lib/whatsapp/encryption';

export const maxDuration = 60;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`cb:groupMedia:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) return rateLimitResponse(limit);

    const { messageId } = await params;

    // Autorização pela RLS do pedido: se o cliente do usuário não enxerga a
    // mensagem, ela não é da conta dele e acaba aqui. O service-role só entra
    // DEPOIS desta checagem, para ler a tabela de ponteiros (que ninguém
    // logado pode ler) e gravar o resultado.
    const { data: msg } = await ctx.supabase
      .from('messages')
      .select('id, content_type, media_url, media_state, conversation_id, conversations!inner(id, group_id, channel_id)')
      .eq('id', messageId)
      .maybeSingle();

    if (!msg) {
      return NextResponse.json({ error: 'Mensagem não encontrada.' }, { status: 404 });
    }

    const conversa = (msg as { conversations?: { group_id?: string | null; channel_id?: string | null } })
      .conversations;
    if (!conversa?.group_id) {
      return NextResponse.json(
        { error: 'Esta rota é só para anexos de grupo.' },
        { status: 400 },
      );
    }
    if ((msg as { media_url?: string | null }).media_url) {
      // Já está no Storage — outro atendente clicou primeiro.
      return NextResponse.json({ media_url: (msg as { media_url: string }).media_url });
    }
    if ((msg as { media_state?: string | null }).media_state === 'too_large') {
      return NextResponse.json(
        { error: 'Arquivo grande demais para o CRM guardar. Veja no celular.' },
        { status: 400 },
      );
    }

    const db = admin();

    const { data: ref } = await db
      .from('cb_message_media_ref')
      .select('payload')
      .eq('message_id', messageId)
      .maybeSingle();

    if (!ref) {
      // Sem ponteiro não há como pedir o arquivo à Evolution. Acontece quando
      // o anexo já foi baixado antes (o ponteiro é apagado no sucesso) ou
      // quando a mensagem é anterior ao recurso.
      return NextResponse.json(
        { error: 'Não há mais como recuperar este anexo. Veja no celular.' },
        { status: 410 },
      );
    }

    const canal = await resolveChannelForConversation(db, ctx.accountId, {
      channel_id: conversa.channel_id ?? null,
    });
    if (!canal || canal.provider !== 'evolution' || !canal.base_url || !canal.instance_name || !canal.api_key) {
      return NextResponse.json(
        { error: 'Conexão indisponível para buscar o anexo.' },
        { status: 400 },
      );
    }

    const client = new EvolutionClient({
      baseUrl: canal.base_url,
      instance: canal.instance_name,
      apikey: decrypt(canal.api_key),
    });

    let mediaUrl: string | null = null;
    try {
      mediaUrl = await fetchAndStoreEvolutionMedia({
        db,
        client,
        accountId: ctx.accountId,
        rawMessage: (ref as { payload: unknown }).payload,
        contentType: (msg as { content_type: string }).content_type,
      });
    } catch (err) {
      console.error('[cb/groups/media] download falhou:', err);
    }

    if (!mediaUrl) {
      await db.from('messages').update({ media_state: 'failed' }).eq('id', messageId);
      return NextResponse.json(
        {
          error:
            'O WhatsApp não tem mais este arquivo. Anexo antigo expira no servidor e não há como recuperar pelo CRM.',
        },
        { status: 410 },
      );
    }

    await db
      .from('messages')
      .update({ media_url: mediaUrl, media_state: null })
      .eq('id', messageId);

    // Ponteiro cumpriu o papel. Some junto porque carrega as chaves de
    // decifragem da mídia — guardá-las depois de não precisar mais é
    // superfície de risco de graça.
    await db.from('cb_message_media_ref').delete().eq('message_id', messageId);

    return NextResponse.json({ media_url: mediaUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
