// ============================================================
// O que o ciclo das agendadas (`/api/cb/scheduled/cron`, laço de 15 min)
// faz DEPOIS da resposta, em `after()`: os alarmes de conexão no sino (1122),
// as tarefas recorrentes (1074), o vencimento da Lixeira de contatos (1097),
// o da lixeira de anotações (1132), a poda do conteúdo dos turnos dos agentes
// de IA (1110), a poda das gravações de ligação aos 180 dias (1136), a
// drenagem da fila de arquivos a apagar (1097) e a retomada das transcrições
// de ligação que ficaram para trás (1136) — nesta ordem, sob UM prazo comum.
//
// ⚠️ Por que nesta rota, e não numa nova: rota nova no agendador só roda
// depois de mudar o `command` do `docker-stack.yml` E de um `docker stack
// deploy` manual na VPS (`.claude/rules/deploy.md`). Tirar esta chamada da
// rota (ou a rota do laço) para as oito coisas, sem erro nenhum — pinos
// `tarefas-recorrentes-1074.test.ts` e `manutencao-do-ciclo.test.ts`.
//
// ⚠️ A ORDEM: os alarmes vêm primeiro: são rápidos (duas leituras por
// conexão) e são o aviso que precisa chegar a alguém em minutos. O vencimento
// põe arquivos na fila, e a drenagem do MESMO ciclo já os leva. As tarefas vêm
// antes do vencimento porque são o que alguém vê hoje. O vencimento das
// anotações também enche a fila (o gatilho da 1102 leva os anexos da
// anotação excluída de vez), então vem antes da drenagem. A poda vem DEPOIS do
// vencimento (a ficha excluída de vez limpa os turnos dela como `exclusao`; a
// poda leva o resto como `prazo`) e antes da drenagem, que é quem pode gastar
// o prazo inteiro. A poda das gravações apaga do Storage direto (sem a fila)
// e vem antes da drenagem pelo mesmo motivo. A retomada das transcrições vem
// por ÚLTIMO: cada uma chama o provedor de IA (até minutos), e ela só começa
// com o prazo de uma inteira sobrando — o atraso dela não segura os outros.
//
// ⚠️ Cada passo é ISOLADO: os oito já nunca lançam, e mesmo assim cada um
// roda dentro do próprio try — a falha (ou um defeito futuro que lance) de um
// não impede o seguinte.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { avisarAlarmesDeConexao } from '@/lib/cb-channels/avisar-alarmes';
import { podarConteudoDosTurnos } from '@/lib/ia-agentes/conteudo-dos-turnos';
import {
  drenarArquivosAApagar,
  vencerLixeira,
} from '@/lib/storage/arquivos-a-apagar';
import { vencerLixeiraDeAnotacoes } from '@/lib/notes/vencer-lixeira-de-anotacoes';
import { gerarTarefasRecorrentes } from '@/lib/tasks/gerar-recorrentes';
import { podarGravacoesDeLigacao } from '@/lib/whatsapp/ligacoes/poda';
import { retomarTranscricoes } from '@/lib/whatsapp/ligacoes/transcricao';

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

/** Um passo que lançou (não devia: os oito engolem) não derruba os outros. */
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
  await isolado('alarmes de conexão', () => avisarAlarmesDeConexao(admin, agora));
  await isolado('tarefas recorrentes', () => gerarTarefasRecorrentes(admin));
  await isolado('vencimento da Lixeira', () => vencerLixeira(admin, prazo));
  await isolado('vencimento da lixeira de anotações', () =>
    vencerLixeiraDeAnotacoes(admin, agora)
  );
  await isolado('conteúdo dos turnos da IA', () =>
    podarConteudoDosTurnos(admin, prazo)
  );
  await isolado('gravações de ligação (180 dias)', () =>
    podarGravacoesDeLigacao(admin, prazo)
  );
  await isolado('fila de arquivos a apagar', () =>
    drenarArquivosAApagar(admin, prazo)
  );
  await isolado('transcrições de ligação', () =>
    retomarTranscricoes(admin, prazo)
  );
}
