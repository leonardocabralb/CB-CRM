// ============================================================
// POST /api/cb/negocios/[id]/mover — o botão "avançar" do painel da
// conversa (decisão do operador, 29/09/2026). Corpo: `{ de, para }`, ids de
// etapa.
//
// Move o card SÓ se ele ainda está em `de`. O pedido sai 4 s depois do
// clique (a janela de desfazer), às vezes da página indo embora, às vezes
// refeito pela retomada na abertura seguinte do app
// (`src/lib/pipelines/mover-com-desfazer.ts`): nesse meio-tempo um colega ou
// uma automação pode ter mexido no card, e o update incondicional o levaria
// de volta para trás — disparando as automações da etapa. É a mesma lição do
// formulário de negócio (CLAUDE.md, `deal-form.tsx`).
//
// Nada casou → 409 com a etapa em que o card ESTÁ (quem chama trata "já
// está no destino" como feito — a retomada de um envio que chegou).
//
// Escrita com a sessão de quem clicou (`ctx.supabase`, sob RLS): os
// gatilhos da trilha (912), do resultado (950/1031) e da fila de automações
// (933/1040) valem como para qualquer escritor, e a origem sai `user`. As
// automações drenam pelo aviso de quem chama (`avisarDrenagemDeFunil`) ou,
// se a página já foi embora, pelo agendador.
// ============================================================

import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // `agent` é quem já move card (a RLS de `deals` exige o mesmo papel).
    const ctx = await requireRole('agent');
    const { id } = await params;
    const corpo = (await request.json().catch(() => null)) as {
      de?: unknown;
      para?: unknown;
    } | null;
    const de = typeof corpo?.de === 'string' ? corpo.de : '';
    const para = typeof corpo?.para === 'string' ? corpo.para : '';
    if (!UUID_RE.test(id) || !UUID_RE.test(de) || !UUID_RE.test(para) || de === para) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
    }

    const { data, error } = await ctx.supabase
      .from('deals')
      .update({ stage_id: para })
      .eq('id', id)
      .eq('stage_id', de)
      .select('stage_id, status');
    if (error) {
      // A FK composta `(stage_id, pipeline_id)` recusa etapa de OUTRO funil:
      // o botão move dentro do funil.
      if (error.code === '23503') {
        return NextResponse.json({ error: 'etapa_de_outro_funil' }, { status: 400 });
      }
      console.error('[negocios/mover] update falhou:', error.code, error.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    const movido = (data ?? [])[0] as { stage_id: string; status: string } | undefined;
    if (movido) {
      return NextResponse.json({ ok: true, stage_id: movido.stage_id, status: movido.status });
    }

    // Zero linhas: o card saiu de `de` — ou sumiu (apagado, ou fora do
    // alcance da RLS). A leitura separa os dois.
    const { data: atual, error: erroLeitura } = await ctx.supabase
      .from('deals')
      .select('stage_id, status')
      .eq('id', id)
      .maybeSingle();
    if (erroLeitura) {
      console.error('[negocios/mover] leitura falhou:', erroLeitura.code, erroLeitura.message);
      return NextResponse.json({ error: 'db_error' }, { status: 500 });
    }
    if (!atual) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(
      { error: 'etapa_mudou', stage_id: atual.stage_id, status: atual.status },
      { status: 409 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
