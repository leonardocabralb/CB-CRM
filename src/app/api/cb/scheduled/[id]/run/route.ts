import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { dispararUma } from '@/lib/scheduled/dispatch';

/**
 * POST /api/cb/scheduled/[id]/run — "Executar agora" e "Tentar de novo".
 *
 * As duas ações são a MESMA operação, e por isso são uma rota só: pegar a
 * linha, reivindicá-la e mandar. O que muda entre elas é de onde a linha
 * partiu (`pending` ou `failed`), o que o `dispararUma` já resolve.
 *
 * ⚠️ Vai DIRETO, sem a janela de desfazer do compositor (P4.10). A janela
 * existe para o arrependimento de quem acabou de digitar; aqui o texto já
 * estava escrito e a pessoa está justamente pedindo para antecipá-lo.
 *
 * ⚠️ Não alcança linha em `sending` — ver a nota em `dispararUma`. Devolve
 * 409, e a tela diz que a mensagem já saiu ou está saindo.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent');

    const limit = checkRateLimit(
      `cb:scheduleRun:${ctx.userId}`,
      RATE_LIMITS.send,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;

    // ⚠️ `accountId` do CONTEXTO, nunca do corpo do pedido: o disparo roda
    // em service-role e passa por cima da RLS, então este parâmetro é a
    // única coisa separando as contas neste caminho.
    const r = await dispararUma(supabaseAdmin(), ctx.accountId, id);

    if (!r) {
      return NextResponse.json(
        {
          error:
            'Esta mensagem já saiu, está saindo agora ou foi apagada. Recarregue a conversa.',
        },
        { status: 409 },
      );
    }

    if (!r.enviada) {
      return NextResponse.json(
        { error: r.erro ?? 'Não foi possível enviar.' },
        { status: 502 },
      );
    }

    return NextResponse.json({ sent: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
