import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { rodarCicloDoRadar } from '@/lib/cb-radar/worker';

/**
 * O worker do Radar de Atendimento (migration 941).
 *
 * ⚠️ Como nas agendadas: sem alguém batendo aqui, o Radar não existe — a
 * tabela `cb_conversation_insights` fica vazia e o painel /radar mostra
 * "nunca analisado". Quem chama é o serviço `agendador` da VPS (laço
 * lento, a cada 15 min; ver docker-stack.yml e docs/DEPLOY-VPS.md). O
 * throttle de 30 min por conversa mora no worker, então bater com mais
 * frequência não custa análise repetida.
 *
 * Auth: o MESMO `AUTOMATION_CRON_SECRET` das três rotas irmãs — um
 * segredo só para o operador provisionar. Sem a env: 503, sem disparar
 * nada (deploy que esqueceu a variável falha alto, não vira endpoint
 * aberto queimando tokens da conta).
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }

  const supplied = request.headers.get('x-cron-secret') ?? '';
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  try {
    const r = await rodarCicloDoRadar(admin);

    // Batimento (927/937): escrito DEPOIS do ciclo — significa "um ciclo
    // inteiro terminou". Best-effort: perder um batimento só adianta o
    // aviso de saúde na tela, que é o lado seguro.
    const { error: batErr } = await admin
      .from('cb_agendador_batimento')
      .update({ ultimo_ciclo_radar: new Date().toISOString() })
      .eq('id', true);
    if (batErr) {
      console.error('[radar] batimento não gravou:', batErr.message);
    }

    // Log só quando houve trabalho — 96 ciclos/dia de zeros esconderiam
    // o que importa.
    if (r.analisadas || r.falhas || r.travadasRecolhidas) {
      console.log(
        `[radar] ciclo: ${r.analisadas} analisada(s), ${r.falhas} falha(s), ` +
          `${r.travadasRecolhidas} travada(s) recolhida(s), ${r.candidatas} candidata(s)`,
      );
    }
    return NextResponse.json(r);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[radar] ciclo estourou:', motivo);
    return NextResponse.json({ error: motivo }, { status: 500 });
  }
}
