// ============================================================
// POST /api/cb/tasks/vistas — a tela avisa que o RESPONSÁVEL viu estas
// tarefas (1068). Decisão do operador (29/09/2026): ficar visível na tela da
// pessoa conta como vista; na primeira vez grava `vista_em` e, se ainda não
// lida, `lida_em`. Quem chama é `useVistaDaTarefa`, em lote.
//
// ⚠️ A CERCA É A CONSULTA, não o navegador: `responsavel_user_id = quem
// chama` (a régua de `podeNaTarefa('marcar-lida')`: só o destinatário lê a
// própria tarefa, nem o admin), tarefa ABERTA e `vista_em IS NULL` (a primeira
// vez é o registro; repetir o pedido não muda nada). Com a cerca no UPDATE,
// duas abas mandando o mesmo lote gravam uma vez só.
//
// ⚠️ Service role porque o navegador não escreve em `cb_tasks` (944) — e por
// isso toda escrita leva o `account_id` da SESSÃO.
//
// São DUAS escritas, porque o PostgREST não faz `coalesce(lida_em, now())`:
// a primeira pega as ainda não lidas e grava as duas colunas; a segunda, as
// já lidas à mão, e grava só a vista. Sem a segunda, a tarefa lida antes
// desta rota existir ficaria "não vista" para sempre no card da equipe.
// ============================================================

import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { idsDoPedido } from '@/lib/tasks/vista';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const limite = checkRateLimit(
      `cb:taskVista:${ctx.userId}`,
      RATE_LIMITS.tarefaVista,
    );
    if (!limite.success) return rateLimitResponse(limite);

    const ids = idsDoPedido(await request.json().catch(() => null));
    if (!ids) {
      return NextResponse.json({ error: 'ids is required' }, { status: 400 });
    }

    const admin = supabaseAdmin();
    const agora = new Date().toISOString();
    const naoVistasDeQuemChama = (colunas: Record<string, string>) =>
      admin
        .from('cb_tasks')
        .update(colunas)
        .eq('account_id', ctx.accountId)
        .eq('responsavel_user_id', ctx.userId)
        .eq('status', 'aberta')
        .is('vista_em', null)
        .in('id', ids);

    const lidasAgora = await naoVistasDeQuemChama({
      vista_em: agora,
      lida_em: agora,
    })
      .is('lida_em', null)
      .select('id');
    if (lidasAgora.error) {
      console.error('[POST /api/cb/tasks/vistas] falhou:', lidasAgora.error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    const jaLidas = await naoVistasDeQuemChama({ vista_em: agora })
      .not('lida_em', 'is', null)
      .select('id');
    if (jaLidas.error) {
      console.error('[POST /api/cb/tasks/vistas] falhou:', jaLidas.error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }

    const vistas = [...(lidasAgora.data ?? []), ...(jaLidas.data ?? [])].map(
      (l) => (l as { id: string }).id,
    );
    return NextResponse.json({ vistas });
  } catch (err) {
    return toErrorResponse(err);
  }
}
