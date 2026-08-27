import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ESTADOS_DO_INSIGHT, type EstadoDoInsight } from '@/lib/cb-radar/ordenacao';

/**
 * PATCH /api/cb/radar/[conversationId]/estado — o ciclo de vida do sinal:
 * aberto → tratado | descartado (e de volta, se alguém marcou errado).
 *
 * É rota de API, e não UPDATE do navegador, DE PROPÓSITO: a 941 revogou
 * INSERT/UPDATE/DELETE de `authenticated` na tabela inteira (o padrão da
 * trilha 912). Sem a rota, um update do navegador voltaria "0 linhas" com
 * cara de sucesso. Aqui o service-role escreve, com a posse conferida por
 * `account_id` explícito.
 *
 * `descartado` não é lixeira: é o dado da calibração — "a IA apontou e o
 * operador disse que não era nada" é exatamente a taxa de falso positivo.
 */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    const limit = checkRateLimit(`radar:estado:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as { estado?: unknown } | null;
    const estado = body?.estado;
    if (
      typeof estado !== 'string' ||
      !ESTADOS_DO_INSIGHT.includes(estado as EstadoDoInsight)
    ) {
      return NextResponse.json(
        { error: 'estado deve ser "aberto", "tratado" ou "descartado"' },
        { status: 400 },
      );
    }

    const { conversationId } = await params;
    const { data, error } = await supabaseAdmin()
      .from('cb_conversation_insights')
      .update({
        estado,
        estado_por: ctx.userId,
        estado_em: new Date().toISOString(),
      })
      .eq('conversation_id', conversationId)
      .eq('account_id', ctx.accountId)
      .select('id')
      .maybeSingle();
    if (error) {
      console.error('[radar] estado não gravou:', error.message);
      return NextResponse.json({ error: 'Falha ao gravar o estado.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, estado });
  } catch (err) {
    return toErrorResponse(err);
  }
}
