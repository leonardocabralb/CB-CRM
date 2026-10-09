import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { carregarDadosDaPauta, carregarPassosDosNegocios, instanteDoParametro } from '@/lib/reunioes/carregar';
import { montarPauta } from '@/lib/reunioes/montar';
import { reunioesDoResumo } from '@/lib/reunioes/resumo';

/** Sem `de`: desde o começo ("Total" no Desempenho). */
const DESDE_O_COMECO = new Date(0);

/**
 * GET /api/cb/reunioes/resumo?de=<ISO>&ate=<ISO>  (admin+)
 *
 * As reuniões que JÁ COMEÇARAM na janela, para a seção "Reuniões" do
 * Desempenho do funil (Fase 4 de `docs/PLANO-reagendamento.md`): de cada uma,
 * só quando foi, o funil em que o card estava no início dela e o resultado —
 * nenhum dado do cliente. A conta por funil e por período é da tela
 * (`src/lib/funil/comparecimento.ts`).
 *
 * - ⚠️ A MESMA carga e a MESMA régua da pauta (`carregarDadosDaPauta` →
 *   `montarPauta`): o resultado de uma reunião não pode ser um na pauta e
 *   outro no Desempenho.
 * - Os dois parâmetros são opcionais: sem `de`, desde o começo; sem `ate`,
 *   até agora. Sem o teto de 120 dias da pauta — o Desempenho pede "Este ano"
 *   e "Total" (a carga pagina pela chave).
 * - Só admin, como o Desempenho (`canViewReports`). O limite de pedidos é o
 *   da pauta, com chave própria.
 * - Toda consulta leva `account_id`. Erro de leitura é 500, nunca lista vazia.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const limit = checkRateLimit(`cb:reunioes:resumo:${ctx.userId}`, RATE_LIMITS.pautaDeReunioes);
    if (!limit.success) return rateLimitResponse(limit);

    const url = new URL(request.url);
    const deCru = url.searchParams.get('de');
    const ateCru = url.searchParams.get('ate');
    const agora = new Date();
    const de = deCru === null ? DESDE_O_COMECO : instanteDoParametro(deCru);
    const pedido = ateCru === null ? agora : instanteDoParametro(ateCru);
    if (!de || !pedido) return NextResponse.json({ error: 'janela_invalida' }, { status: 400 });
    // Janela que ainda não começou: não há reunião começada nela — é resposta,
    // não ignorância. Vem ANTES da conferência do fim: o período personalizado
    // só com "De" no futuro manda como fim o de hoje (`fimDoIntervalo`), e
    // recusar viraria "não foi possível carregar" para sempre.
    if (de >= agora) return NextResponse.json({ reunioes: [] });
    if (ateCru !== null && pedido <= de) return NextResponse.json({ error: 'janela_invalida' }, { status: 400 });
    // Só o que já começou: a carga vai até o menor entre o fim pedido e agora.
    const ate = pedido < agora ? pedido : agora;

    const admin = supabaseAdmin();
    const dados = await carregarDadosDaPauta(admin, ctx.accountId, { de, ate });
    const { reunioes } = montarPauta(dados);
    const negocios = reunioes.flatMap((r) => (r.negocio ? [r.negocio.id] : []));
    const passos = await carregarPassosDosNegocios(admin, ctx.accountId, negocios);
    return NextResponse.json({ reunioes: reunioesDoResumo(reunioes, passos, agora) });
  } catch (err) {
    if (err instanceof Error && !('status' in err)) {
      console.error('[reunioes/resumo] leitura falhou:', err.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    return toErrorResponse(err);
  }
}
