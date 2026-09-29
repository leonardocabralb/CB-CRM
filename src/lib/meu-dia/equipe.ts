// ============================================================
// O card "Equipe" do Meu dia (pedido do operador, 29/09/2026): para quem
// administra ou acompanha a equipe, as tarefas VENCIDAS e as de HOJE de cada
// membro, separando as que o responsável ainda NÃO VIU (1068) — "não vista e
// não cumprida" é outro problema que "vista e não cumprida".
//
// Puro: o hook traz as tarefas abertas com prazo até hoje, da conta INTEIRA
// (a policy de `cb_tasks` já mostra tudo a qualquer membro — a tela de
// Tarefas tem a visão "Todas" para todo mundo), e a lista de membros; aqui se
// agrupa e ordena.
//
// ⚠️ A própria pessoa fica FORA: as tarefas dela estão no card "Suas
// tarefas", logo abaixo, e repeti-las aqui faria o gestor se contar duas
// vezes.
// ⚠️ Membro SUSPENSO com tarefa aparece (a tarefa continua com ele — decisão
// da 1067 — e é o gestor quem precisa redirecioná-la); sem tarefa, não entra
// no "em dia" (não está trabalhando).
// ⚠️ Tarefa de quem já não está na lista de membros aparece com o nome
// CONGELADO na tarefa; tarefa sem responsável (o login foi apagado — a coluna
// é SET NULL) vira uma linha própria: é exatamente a que ninguém cobra.
// ============================================================

import type { Task } from '@/types';

export type TarefaDaEquipe = Pick<
  Task,
  | 'id'
  | 'titulo'
  | 'vence_em'
  | 'vence_as'
  | 'responsavel_user_id'
  | 'responsavel_nome'
  | 'vista_em'
  | 'contact_id'
> & {
  contact: {
    id: string;
    name: string | null;
    phone: string | null;
    wa_username?: string | null;
    instagram_username?: string | null;
  } | null;
};

export interface MembroDaEquipe {
  user_id: string;
  full_name: string;
  suspenso_em?: string | null;
}

export interface LinhaDaEquipe<T extends TarefaDaEquipe = TarefaDaEquipe> {
  /** `null` = tarefas sem responsável (o login de quem era foi apagado). */
  userId: string | null;
  /** `null` = sem nome conhecido — a tela escreve o seu "sem responsável". */
  nome: string | null;
  suspenso: boolean;
  /** Tem tarefa, mas não está mais na lista de membros (saiu da conta). */
  foraDaEquipe: boolean;
  /** Mais antiga primeiro. */
  vencidas: T[];
  /** Pela hora, sem hora por último. */
  hoje: T[];
  vencidasNaoVistas: number;
  hojeNaoVistas: number;
}

export interface ResumoDaEquipe<T extends TarefaDaEquipe = TarefaDaEquipe> {
  comTarefas: LinhaDaEquipe<T>[];
  /**
   * Membros ativos sem nada vencido nem para hoje, por nome. `null` = a lista
   * de membros não veio: não se sabe quem está em dia, e "todos em dia" seria
   * afirmação sem resposta.
   */
  emDia: { userId: string; nome: string }[] | null;
}

const porPrazo = (a: TarefaDaEquipe, b: TarefaDaEquipe): number => {
  if (a.vence_em !== b.vence_em) return a.vence_em < b.vence_em ? -1 : 1;
  // Sem hora vai para o fim do dia: "até hoje" sem hora é o dia inteiro.
  if (a.vence_as !== b.vence_as) {
    if (!a.vence_as) return 1;
    if (!b.vence_as) return -1;
    return a.vence_as < b.vence_as ? -1 : 1;
  }
  return a.id < b.id ? -1 : 1;
};

const porNome = (a: string | null, b: string | null): number =>
  (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' });

/**
 * Agrupa por responsável.
 *
 * @param hoje `YYYY-MM-DD` no dia de QUEM LÊ — a régua da tela de Tarefas
 *   (`diaLocal`), para o número bater com a tela para onde o gestor vai.
 */
export function resumirEquipe<T extends TarefaDaEquipe>(
  tarefas: readonly T[],
  membros: readonly MembroDaEquipe[] | null,
  euId: string,
  hoje: string,
): ResumoDaEquipe<T> {
  const membroPorId = new Map((membros ?? []).map((m) => [m.user_id, m]));
  const linhas = new Map<string, LinhaDaEquipe<T>>();

  for (const t of tarefas) {
    if (t.vence_em > hoje) continue;
    if (t.responsavel_user_id === euId) continue;
    const chave = t.responsavel_user_id ?? '';
    let linha = linhas.get(chave);
    if (!linha) {
      const membro = t.responsavel_user_id
        ? membroPorId.get(t.responsavel_user_id)
        : undefined;
      linha = {
        userId: t.responsavel_user_id,
        nome: t.responsavel_user_id
          ? membro?.full_name?.trim() || t.responsavel_nome || null
          : null,
        suspenso: !!membro?.suspenso_em,
        foraDaEquipe:
          !!t.responsavel_user_id && membros !== null && !membro,
        vencidas: [],
        hoje: [],
        vencidasNaoVistas: 0,
        hojeNaoVistas: 0,
      };
      linhas.set(chave, linha);
    }
    if (t.vence_em < hoje) {
      linha.vencidas.push(t);
      if (!t.vista_em) linha.vencidasNaoVistas++;
    } else {
      linha.hoje.push(t);
      if (!t.vista_em) linha.hojeNaoVistas++;
    }
  }

  const comTarefas = [...linhas.values()];
  for (const l of comTarefas) {
    l.vencidas.sort(porPrazo);
    l.hoje.sort(porPrazo);
  }
  comTarefas.sort(
    (a, b) =>
      b.vencidas.length - a.vencidas.length ||
      b.vencidasNaoVistas - a.vencidasNaoVistas ||
      b.hoje.length - a.hoje.length ||
      // A linha sem responsável fecha o empate: é de ninguém.
      Number(a.userId === null) - Number(b.userId === null) ||
      porNome(a.nome, b.nome),
  );

  const emDia =
    membros === null
      ? null
      : membros
          .filter(
            (m) =>
              m.user_id !== euId && !m.suspenso_em && !linhas.has(m.user_id),
          )
          .map((m) => ({ userId: m.user_id, nome: m.full_name }))
          .sort((a, b) => porNome(a.nome, b.nome));

  return { comTarefas, emDia };
}
