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

    const body = (await request.json().catch(() => null)) as {
      estado?: unknown;
      analisado_em?: unknown;
    } | null;
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
    // ⚠️ Trava otimista contra a corrida com o WORKER (ledger 48h): a lista
    // da tela é uma foto de até 2 min, e o worker pode ter REANALISADO a
    // conversa no intervalo. Sem a trava, "Tratar" carimbava um sinal que o
    // operador nunca viu — e `tratado` só reabre com mensagem do cliente
    // POSTERIOR ao estado_em, então o sinal novo não voltava sozinho. O
    // cliente manda o `analisado_em` da análise que ESTÁ VENDO; se a linha
    // já mudou, 409 e a tela recarrega em vez de esconder o que ninguém leu.
    // Reabrir (estado='aberto') fica fora da trava: tornar visível de novo
    // nunca esconde nada. Sem carimbo no corpo, comporta como antes.
    const analisadoEmVisto =
      typeof body?.analisado_em === 'string' && body.analisado_em
        ? body.analisado_em
        : null;

    const { conversationId } = await params;
    let query = supabaseAdmin()
      .from('cb_conversation_insights')
      .update({
        estado,
        estado_por: ctx.userId,
        estado_em: new Date().toISOString(),
      })
      .eq('conversation_id', conversationId)
      .eq('account_id', ctx.accountId);
    if (estado !== 'aberto' && analisadoEmVisto) {
      query = query.eq('analisado_em', analisadoEmVisto);
    }
    const { data, error } = await query.select('id').maybeSingle();
    if (error) {
      console.error('[radar] estado não gravou:', error.message);
      return NextResponse.json({ error: 'Falha ao gravar o estado.' }, { status: 500 });
    }
    if (!data) {
      // A linha existe mas mudou de análise? Distinguir do 404 verdadeiro
      // para a tela poder dizer "o Radar reanalisou — releia" em vez de
      // "não encontrada".
      if (estado !== 'aberto' && analisadoEmVisto) {
        const { data: aindaExiste } = await supabaseAdmin()
          .from('cb_conversation_insights')
          .select('id')
          .eq('conversation_id', conversationId)
          .eq('account_id', ctx.accountId)
          .maybeSingle();
        if (aindaExiste) {
          return NextResponse.json({ error: 'analysis_changed' }, { status: 409 });
        }
      }
      return NextResponse.json({ error: 'Análise não encontrada.' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, estado });
  } catch (err) {
    return toErrorResponse(err);
  }
}
