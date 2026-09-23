// ============================================================
// Reentrega dos avisos `deal.*` que ficaram PENDENTES (migration 1040).
//
// O dreno da fila do funil grava `webhooks_pendente_desde` na MESMA escrita
// em que reivindica a linha, e a entrega limpa a coluna quando a tentativa
// aconteceu (`entregar-eventos-de-funil.ts`). O que continua pendente além
// de `PRAZO_PARA_REENTREGAR_MS` é aviso cuja entrega não chegou a ser
// tentada: processo morto no meio (SIGKILL do rollout, queda), leitura dos
// endpoints ou do catálogo que falhou, linha que estourou. Este módulo —
// chamado SÓ pelo cron de automações, nunca pelo aviso imediato do
// navegador — os entrega de novo, pela MESMA `entregarEventosDeFunil`, com o
// MESMO id e a hora do fato: é o contrato ("o id dos `deal.*` é seguro para
// deduplicar") que torna a repetição aceitável.
//
// ⚠️ Módulo próprio, e não mais uma função em `drain-events.ts`: o pino do
// dreno cobra UMA chamada a `entregarEventosDeFunil` naquele arquivo, e as
// duas entregas não podem se confundir.
//
// ⚠️⚠️ A reivindicação é por COMPARE-AND-SWAP no carimbo lido
// (`.eq('webhooks_pendente_desde', <o valor que o SELECT viu>)`), a mesma
// cerca de posse do Calendly e do Radar: dois ciclos do cron ao mesmo tempo
// (no deploy `start-first` há dois processos vivos) leem a mesma linha, e só
// um leva. O carimbo NOVO é também a cerca com que a entrega limpa depois —
// a entrega antiga, se ainda estiver viva, não apaga a pendência desta.
//
// ⚠️ SEM teto de IDADE (decisão do operador: evento atrasado sai sempre, com
// a hora real em `occurred_at`). O teto é de TENTATIVAS: passado dele, a
// linha FICA com `webhooks_pendente_desde` preenchido — é o registro, no
// banco, do aviso que não saiu —, e a poda de 30 dias a leva. Sem o teto,
// uma linha que estoura sempre (dado estranho no `montarAviso`) seria
// reentregue a cada ciclo para sempre.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { after } from 'next/server';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { entregarEventosDeFunil } from '@/lib/webhooks/entregar-eventos-de-funil';
import type { CbAutomationEvent } from '@/types';

/**
 * Quanto tempo uma linha pode ficar pendente antes de ser reentregue.
 *
 * Folga larga sobre o pior caso LEGÍTIMO em processo: no cron, a entrega só
 * começa depois do ciclo inteiro (até ~50 s, o `-m` do curl do agendador) e
 * custa até ~65 s por conta com um endpoint lento. Curto demais, a reentrega
 * tomaria linha que a entrega original ainda está mandando — e o aviso sairia
 * duas vezes sem ninguém ter morrido.
 */
export const PRAZO_PARA_REENTREGAR_MS = 10 * 60 * 1000;

/** Reentregas por aviso. Passado disso ele fica marcado, e só. */
export const TETO_DE_REENTREGAS = 5;

/** Linhas por ciclo — o mesmo teto do dreno, e o que a entrega espera receber. */
const LOTE = 50;

export interface ResultadoDaReentrega {
  /** Linhas retomadas e agendadas para entrega. */
  reentregues: number;
  falhas: number;
}

/**
 * Retoma os avisos pendentes e os agenda para entrega. Nunca lança — roda no
 * ciclo do cron, que não pode cair por causa de um integrador.
 */
export async function reentregarEventosDeFunil(
  db: SupabaseClient = supabaseAdmin(),
  agoraMs: number = Date.now()
): Promise<ResultadoDaReentrega> {
  const saida: ResultadoDaReentrega = { reentregues: 0, falhas: 0 };
  const retomadas: CbAutomationEvent[] = [];
  const carimbo = new Date(agoraMs).toISOString();
  try {
    const corte = new Date(agoraMs - PRAZO_PARA_REENTREGAR_MS).toISOString();
    const { data: pendentes, error } = await db
      .from('cb_automation_events')
      .select('*')
      .lt('webhooks_pendente_desde', corte)
      .lt('webhooks_tentativas', TETO_DE_REENTREGAS)
      // A ordem do fato, como no dreno.
      .order('criado_em', { ascending: true })
      .limit(LOTE);
    if (error) {
      console.error('[webhooks] reentrega: leitura dos avisos pendentes falhou', error);
      return saida;
    }

    for (const linha of (pendentes ?? []) as CbAutomationEvent[]) {
      const { data: tomada, error: erroClaim } = await db
        .from('cb_automation_events')
        .update({
          webhooks_pendente_desde: carimbo,
          webhooks_tentativas: linha.webhooks_tentativas + 1,
        })
        .eq('id', linha.id)
        // ⚠️ A cerca: só leva quem ainda vê o MESMO carimbo que o SELECT viu.
        .eq('webhooks_pendente_desde', linha.webhooks_pendente_desde as string)
        .select('*')
        .maybeSingle();
      if (erroClaim) {
        console.error('[webhooks] reentrega: reivindicação falhou', linha.id, erroClaim);
        saida.falhas += 1;
        continue;
      }
      // Outro ciclo levou, ou a entrega original limpou no meio-tempo.
      if (!tomada) continue;
      retomadas.push(tomada as CbAutomationEvent);
    }
  } catch (err) {
    console.error('[webhooks] reentrega falhou', err);
  }

  if (retomadas.length === 0) return saida;
  saida.reentregues = retomadas.length;
  const ultimas = retomadas.filter((l) => l.webhooks_tentativas >= TETO_DE_REENTREGAS);
  console.warn(
    `[webhooks] reentrega: ${retomadas.length} aviso(s) deal.* pendente(s) retomado(s)` +
      (ultimas.length
        ? ` — ${ultimas.length} na última tentativa; se falhar, fica(m) marcado(s) sem entrega: ${ultimas.map((l) => l.id).join(', ')}`
        : '')
  );

  // Mesmo molde do dreno: DEPOIS da resposta do cron, e aguardada quando não
  // há requisição onde agendar (`after()` lança fora dela).
  const entregar = () => entregarEventosDeFunil(db, retomadas, carimbo);
  try {
    after(entregar);
  } catch {
    await entregar();
  }
  return saida;
}
