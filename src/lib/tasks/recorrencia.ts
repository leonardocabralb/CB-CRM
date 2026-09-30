// ============================================================
// Tarefa recorrente (1074) — a parte PURA, usada pela rota e pela tela.
//
// A série é um grupo de tarefas com o mesmo `serie_id`; a mais recente é a
// ATIVA, o molde da próxima, que nasce sozinha no dia do prazo dela
// (`gerar-recorrentes.ts`, no ciclo do agendador).
// ============================================================

import type { Task } from '@/types';

/**
 * Esta é a ativa de uma série que ainda repete?
 *
 * ⚠️ Apagar a ativa ENCERRA a série: ela é o molde e o relógio da próxima, e
 * a anterior já foi carimbada (`proxima_gerada_em`). A rota de apagar usa isto
 * para limpar a repetição das irmãs, e a tela para avisar antes do clique.
 */
export function ehAtivaDaSerie(
  t: Pick<Task, 'repetir_a_cada_dias' | 'proxima_gerada_em'>,
): boolean {
  // `!= null` (e não `!== null`): a linha lida sem as colunas da 1074 traz
  // `undefined` nas duas, e não pode passar por ativa.
  return t.repetir_a_cada_dias != null && t.proxima_gerada_em == null;
}
