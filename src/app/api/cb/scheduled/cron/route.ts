import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { dispararVencidas } from '@/lib/scheduled/dispatch';

/**
 * O worker das mensagens agendadas (migration 925).
 *
 * ⚠️ ESTA ROTA É A FEATURE INTEIRA. Sem alguém batendo aqui, `cb_scheduled_
 * messages` é uma tabela que só enche — o mesmo destino de
 * `broadcasts.scheduled_at`, que existe desde a 001 e nunca teve leitor. Quem
 * chama é um cron na VPS (P4.1); ver `docs/DEPLOY-VPS.md`.
 *
 * Auth: reusa `AUTOMATION_CRON_SECRET`, igual ao `/api/flows/cron` fez, para
 * o operador ter um segredo só para provisionar. Comparação em tempo
 * constante, mesmo molde de `/api/automations/cron`.
 *
 * ⚠️ Sem o segredo configurado a rota devolve 503 e NÃO dispara nada. É de
 * propósito: um deploy que esqueceu a variável falha alto, em vez de virar um
 * endpoint aberto que qualquer um usa para adiantar mensagens de clientes.
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
    const r = await dispararVencidas(admin);

    // ⚠️ O BATIMENTO (927). Sem ele, "agendador morto" e "dia sem mensagem"
    // produzem o mesmo silêncio — e é assim que o cron das automações passou
    // semanas parado neste projeto sem ninguém notar. Escrito DEPOIS do ciclo,
    // de propósito: o carimbo significa "um ciclo inteiro terminou", não
    // "alguém bateu na porta".
    //
    // Best-effort: falhar aqui não pode desfazer envios que já saíram. Um
    // batimento perdido só adianta o aviso na tela, que é o lado seguro.
    const { error: batErr } = await admin
      .from('cb_agendador_batimento')
      .update({
        ultimo_ciclo: new Date().toISOString(),
        enviadas_no_ultimo: r.enviadas,
        falhas_no_ultimo: r.falhas,
      })
      .eq('id', true);
    if (batErr) {
      console.error('[agendadas] batimento não gravou:', batErr.message);
    }
    // Registrado no log só quando houve o que fazer — um ciclo por minuto,
    // 24h por dia, encheria o log de zeros e esconderia o que importa.
    if (r.enviadas || r.falhas || r.atrasadas || r.travadas) {
      console.log(
        `[agendadas] ciclo: ${r.enviadas} enviada(s), ${r.falhas} falha(s), ${r.atrasadas} recusada(s) por atraso, ${r.travadas} recolhida(s) de travamento`,
      );
    }
    return NextResponse.json(r);
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[agendadas] ciclo estourou:', motivo);
    return NextResponse.json({ error: motivo }, { status: 500 });
  }
}
