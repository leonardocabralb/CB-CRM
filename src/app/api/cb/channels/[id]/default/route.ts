// ============================================================
// POST /api/cb/channels/[id]/default
//
// Torna este canal o PADRÃO da conta. Admin+.
//
// Existe porque, sem ela, tudo que NÃO passa por uma conversa fica preso ao
// primeiro canal criado: broadcast, sync/criação de modelos e a API pública
// leem o espelho `whatsapp_config`. Numa conta cujo padrão é Evolution, o
// operador conecta o número oficial da Meta e mesmo assim recebe
// "Broadcasts require an official Meta (Cloud API) number" — um beco sem
// saída que só se resolvia mexendo direto no banco.
//
// É POST (não PATCH em /[id]) porque a operação move DUAS tabelas e não é
// uma edição de campo: ver src/lib/cb-channels/set-default.ts.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { listChannels } from '@/lib/cb-channels/repo';
import { setDefaultChannel } from '@/lib/cb-channels/set-default';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(
      `cb:channelSetDefault:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { id } = await params;
    const result = await setDefaultChannel(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      id,
    );

    if (!result.ok) {
      const status =
        result.code === 'not_found'
          ? 404
          : result.code === 'incomplete'
            ? 400
            : 500;
      return NextResponse.json({ error: result.message }, { status });
    }

    // Devolve a lista inteira: o padrão mudou de lugar, então a UI precisa
    // repintar todas as linhas, não só a promovida.
    const channels = await listChannels(ctx.supabase, ctx.accountId);
    return NextResponse.json({
      channels,
      warning: result.mirrorWarning,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
