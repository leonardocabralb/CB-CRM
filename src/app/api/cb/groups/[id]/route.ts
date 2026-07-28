// ============================================================
// PATCH /api/cb/groups/[id]
//
// Dois renomes DIFERENTES, e a diferença é a razão de serem campos separados:
//
//   `alias`   — apelido só nosso. Ninguém no grupo percebe. Reversível.
//   `subject` — o nome DE VERDADE no WhatsApp. Todo participante vê a
//               notificação "Fulano mudou o nome do grupo". Exige ser admin.
//
// O segundo é ação para FORA e por isso pede `renomear_no_whatsapp: true`
// explícito no corpo: um cliente que mandasse `{ subject }` por engano
// mudaria o nome do grupo de um cliente sem ninguém ter pedido.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { getChannelWithSecrets } from '@/lib/cb-channels/repo';
import { EvolutionClient } from '@/lib/whatsapp/transport/evolution-client';
import { decrypt } from '@/lib/whatsapp/encryption';

const MAX_NOME = 100;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`cb:groupUpdate:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const body = (await request.json().catch(() => null)) as {
      alias?: unknown;
      subject?: unknown;
      renomear_no_whatsapp?: unknown;
    } | null;

    const { data: grupo } = await ctx.supabase
      .from('cb_groups')
      .select('id, jid, channel_id, we_are_admin')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (!grupo) {
      return NextResponse.json({ error: 'Grupo não encontrado.' }, { status: 404 });
    }

    const patch: Record<string, unknown> = {};

    // Apelido interno. String vazia LIMPA o apelido (volta a mostrar o nome
    // real) — é o único jeito de desfazer, então não pode ser tratada como
    // "campo ausente".
    if ('alias' in (body ?? {})) {
      const alias = typeof body?.alias === 'string' ? body.alias.trim() : '';
      if (alias.length > MAX_NOME) {
        return NextResponse.json(
          { error: `O apelido deve ter no máximo ${MAX_NOME} caracteres.` },
          { status: 400 },
        );
      }
      patch.alias = alias || null;
    }

    // Renome DE VERDADE. Exige o sinalizador explícito + ser admin.
    if (body?.renomear_no_whatsapp === true) {
      const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
      if (!subject) {
        return NextResponse.json(
          { error: 'O nome do grupo não pode ficar vazio.' },
          { status: 400 },
        );
      }
      if (subject.length > MAX_NOME) {
        return NextResponse.json(
          { error: `O nome deve ter no máximo ${MAX_NOME} caracteres.` },
          { status: 400 },
        );
      }
      // Checagem própria antes de gastar a chamada: a Evolution devolveria um
      // 500 cru, e o operador ficaria sem saber que o problema é permissão.
      if ((grupo as { we_are_admin: boolean | null }).we_are_admin !== true) {
        return NextResponse.json(
          { error: 'Só administradores do grupo podem mudar o nome dele no WhatsApp.' },
          { status: 403 },
        );
      }

      const channelId = (grupo as { channel_id: string | null }).channel_id;
      const canal = channelId
        ? await getChannelWithSecrets(ctx.supabase, ctx.accountId, channelId)
        : null;
      if (!canal?.server_url || !canal.instance_name || !canal.api_key) {
        return NextResponse.json(
          { error: 'Conexão indisponível para renomear o grupo.' },
          { status: 400 },
        );
      }

      const client = new EvolutionClient({
        baseUrl: canal.server_url,
        instance: canal.instance_name,
        apikey: decrypt(canal.api_key),
      });

      try {
        await client.updateGroupSubject(
          (grupo as { jid: string }).jid,
          subject,
        );
      } catch (err) {
        console.error('[cb/groups PATCH] renomear no WhatsApp falhou:', err);
        return NextResponse.json(
          { error: 'O WhatsApp recusou a mudança de nome. Tente de novo em instantes.' },
          { status: 502 },
        );
      }
      // Só grava depois de o WhatsApp aceitar. Gravar antes deixaria a tela
      // mostrando um nome que o grupo não tem.
      patch.subject = subject;
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('cb_groups')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[cb/groups PATCH] erro:', error.message);
      return NextResponse.json({ error: 'Falha ao atualizar o grupo.' }, { status: 500 });
    }
    return NextResponse.json({ group: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
