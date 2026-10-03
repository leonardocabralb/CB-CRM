// ============================================================
// Gerar as tarefas recorrentes do dia (1074) — roda no ciclo do agendador.
//
// ⚠️ PEGA CARONA NO CICLO DAS AGENDADAS (`/api/cb/scheduled/cron`, laço de
// 15 min), em `after()`, em vez de ter rota de cron própria: rota nova só roda
// depois de mudar o `command` do agendador E de um `docker stack deploy`
// manual na VPS — o mesmo motivo que pôs a leitura do Atlas no ciclo do
// Asaas. Tarefa nasce por DIA, então 15 min de folga não mudam nada.
//
// Quem cria as tarefas é o banco (`cb_tarefas_recorrentes_gerar`, numa
// transação só: carimbar a ativa e inserir a próxima). Aqui fica o que o
// banco não sabe: o "hoje" no fuso do escritório (o servidor roda em UTC) e o
// aviso no sino, que é decisão do operador (30/09/2026) e não derruba a
// tarefa se falhar — mesma política da rota de criar.
//
// ⚠️ NUNCA LANÇA: roda depois da resposta, e um erro aqui não pode virar
// rejeição solta no processo. Devolve o que conseguiu e o motivo da falha.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { diaNoFuso, FUSO_PADRAO } from '@/lib/agenda/fuso';
import type { Task } from '@/types';

/** Séries por chamada da função — uma transação por lote. */
export const LOTE_DE_RECORRENTES = 200;

/**
 * Teto de lotes por ciclo. Dez lotes cheios (2.000 séries vencidas no mesmo
 * ciclo) só acontecem depois de o agendador ficar parado; o resto sai no
 * ciclo seguinte, sem segurar este.
 */
const LOTES_NO_MAXIMO = 10;

/**
 * Texto CRU, sem dicionário: `title`/`body` do aviso são gravados no idioma
 * do escritório, como os das outras tarefas (`/api/cb/tasks`).
 */
export const TITULO_DO_AVISO_RECORRENTE = 'Tarefa recorrente para hoje';

export interface ResultadoDasRecorrentes {
  geradas: number;
  /** Tarefas criadas cujo aviso no sino não gravou. */
  semAviso: number;
  /** Motivo, quando a geração parou no meio. */
  erro: string | null;
}

export async function gerarTarefasRecorrentes(
  admin: SupabaseClient,
  agora: Date = new Date(),
): Promise<ResultadoDasRecorrentes> {
  const hoje = diaNoFuso(agora, FUSO_PADRAO);
  let geradas = 0;
  let semAviso = 0;

  try {
    for (let lote = 0; lote < LOTES_NO_MAXIMO; lote++) {
      const { data, error } = await admin.rpc('cb_tarefas_recorrentes_gerar', {
        p_hoje: hoje,
        p_limite: LOTE_DE_RECORRENTES,
      });
      if (error) throw new Error(error.message);

      const novas = (data ?? []) as Task[];
      geradas += novas.length;

      if (novas.length > 0) {
        const { error: erroSino } = await admin.from('notifications').insert(
          novas.map((t) => ({
            account_id: t.account_id,
            // A função só gera para responsável que é membro ativo.
            user_id: t.responsavel_user_id,
            type: 'task_assigned',
            // Sem `conversation_id`: quem roteia o clique é `task_id` (944).
            contact_id: t.contact_id,
            task_id: t.id,
            actor_user_id: t.criador_user_id,
            title: TITULO_DO_AVISO_RECORRENTE,
            body: t.titulo,
          })),
        );
        if (erroSino) {
          console.error('[tarefas recorrentes] aviso não gravou:', erroSino.message);
          semAviso += novas.length;
        }
      }

      if (novas.length < LOTE_DE_RECORRENTES) break;
    }

    if (geradas > 0) {
      console.log(
        `[tarefas recorrentes] ${geradas} gerada(s)${semAviso ? `, ${semAviso} sem aviso` : ''}`,
      );
    }
    return { geradas, semAviso, erro: null };
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido';
    console.error('[tarefas recorrentes] ciclo falhou:', motivo);
    return { geradas, semAviso, erro: motivo };
  }
}
