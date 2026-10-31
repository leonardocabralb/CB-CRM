// ============================================================
// O que o ciclo das agendadas (`/api/cb/scheduled/cron`, laço de 15 min)
// faz DEPOIS da resposta, em `after()`: as tarefas recorrentes (1074), o
// vencimento da Lixeira de contatos (1097), a poda do conteúdo dos turnos dos
// agentes de IA (1110) e a drenagem da fila de arquivos a apagar (1097) —
// nesta ordem, sob UM prazo comum.
//
// ⚠️ Por que nesta rota, e não numa nova: rota nova no agendador só roda
// depois de mudar o `command` do `docker-stack.yml` E de um `docker stack
// deploy` manual na VPS (`.claude/rules/deploy.md`). Tirar esta chamada da
// rota (ou a rota do laço) para as quatro coisas, sem erro nenhum — pinos
// `tarefas-recorrentes-1074.test.ts` e `manutencao-do-ciclo.test.ts`.
//
// ⚠️ A ORDEM: o vencimento põe arquivos na fila, e a drenagem do MESMO ciclo
// já os leva. As tarefas vêm primeiro porque são o que alguém vê hoje. A
// poda vem DEPOIS do vencimento (a ficha excluída de vez limpa os turnos dela
// como `exclusao`; a poda leva o resto como `prazo`) e antes da drenagem, que
// é quem pode gastar o prazo inteiro.
//
// ⚠️ Cada passo é ISOLADO: os quatro já nunca lançam, e mesmo assim cada um
// roda dentro do próprio try — a falha (ou um defeito futuro que lance) de um
// não impede o seguinte.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { podarConteudoDosTurnos } from '@/lib/ia-agentes/conteudo-dos-turnos';
import {
  drenarArquivosAApagar,
  vencerLixeira,
} from '@/lib/storage/arquivos-a-apagar';
import { gerarTarefasRecorrentes } from '@/lib/tasks/gerar-recorrentes';

/**
 * O prazo da manutenção, contado do início do `after()`: 5 min.
 *
 * O `after()` não tem o teto de 120 s do `curl -m` do agendador (a resposta
 * já saiu), mas não pode rodar sem fim. O número fica ABAIXO dos 10 min do
 * recolhimento da fila de arquivos (`cb_reivindicar_arquivos_a_apagar`
 * devolve à fila o que foi reivindicado há mais de 10 min): um lote ainda em
 * voo neste ciclo nunca é pego por outro (raiz, 8e — teto de processamento
 * menor que o recolhimento). E bem abaixo dos 15 min do laço: dois ciclos de
 * manutenção não se sobrepõem. O que não couber sai no ciclo seguinte.
 */
export const PRAZO_DA_MANUTENCAO_MS = 5 * 60_000;

/** Um passo que lançou (não devia: os quatro engolem) não derruba os outros. */
async function isolado(
  nome: string,
  passo: () => Promise<unknown>
): Promise<void> {
  try {
    await passo();
  } catch (err) {
    console.error(
      `[agendadas] manutenção: ${nome} estourou:`,
      err instanceof Error ? err.message : err
    );
  }
}

/** NUNCA lança. `agora` é o início do prazo (injetável no teste). */
export async function rodarManutencaoDoCiclo(
  admin: SupabaseClient,
  agora: number = Date.now()
): Promise<void> {
  const prazo = agora + PRAZO_DA_MANUTENCAO_MS;
  await isolado('tarefas recorrentes', () => gerarTarefasRecorrentes(admin));
  await isolado('vencimento da Lixeira', () => vencerLixeira(admin, prazo));
  await isolado('conteúdo dos turnos da IA', () =>
    podarConteudoDosTurnos(admin, prazo)
  );
  await isolado('fila de arquivos a apagar', () =>
    drenarArquivosAApagar(admin, prazo)
  );
}
