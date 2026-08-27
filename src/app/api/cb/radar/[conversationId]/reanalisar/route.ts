import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { ErroDoRadar, reanalisarConversa } from '@/lib/cb-radar/worker';

/**
 * POST /api/cb/radar/[conversationId]/reanalisar — o botão "Reanalisar
 * agora" do painel. Mesma análise do ciclo, sem esperar o agendador e sem
 * o throttle de 30 min; o opt-in por canal continua valendo (reanálise
 * manual não é licença para analisar canal desligado).
 *
 * `agent`+ porque dispara gasto real na chave de IA da conta; a posse da
 * conversa é conferida DENTRO de `reanalisarConversa` (o worker roda em
 * service-role, então a conferência é por account_id explícito, não RLS).
 */
export const maxDuration = 60;

const STATUS_POR_MOTIVO: Record<ErroDoRadar['motivo'], number> = {
  conversa_nao_encontrada: 404,
  grupo_fora_do_radar: 400,
  conversa_sem_canal: 400,
  radar_desligado_no_canal: 409,
  ja_em_analise: 409,
};

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  try {
    const ctx = await requireRole('agent');
    // Mesmo balde do rascunho de IA: é a mesma natureza de gasto (uma
    // geração por clique) na mesma chave.
    const limit = checkRateLimit(`radar:reanalisar:${ctx.userId}`, RATE_LIMITS.aiDraft);
    if (!limit.success) return rateLimitResponse(limit);

    const { conversationId } = await params;
    const r = await reanalisarConversa(supabaseAdmin(), {
      conversationId,
      accountId: ctx.accountId,
    });
    return NextResponse.json({ ok: true, sem_ia: r.semIa });
  } catch (err) {
    if (err instanceof ErroDoRadar) {
      return NextResponse.json(
        { error: err.motivo },
        { status: STATUS_POR_MOTIVO[err.motivo] },
      );
    }
    return toErrorResponse(err);
  }
}
