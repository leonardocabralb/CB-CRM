// ============================================================
// Quem pode o quê numa tarefa — funções PURAS (migration 944).
//
// ⚠️ ESTE ARQUIVO É A ÚNICA FONTE, e é por isso que `cb_tasks` não tem policy
// de escrita. A alternativa seria repetir estas regras em RLS: a tela
// desabilitaria o botão por uma lógica e o banco recusaria por outra, e as
// duas divergiriam na primeira mudança — com o sintoma sendo um botão que
// parece funcionar e não funciona.
//
// A rota chama estas funções antes de escrever; a tela chama as mesmas para
// decidir o que mostrar. Uma regra, dois consumidores.
//
// ⚠️ CRIAR TAREFA NÃO ESTÁ AQUI, de propósito: qualquer membro da conta cria,
// inclusive `viewer`. É decisão do operador e tem precedente — a anotação
// interna (`canWriteNotes`) já é assim, pela mesma razão: coordenação entre
// colegas não é escrita no cliente, e travar o `viewer` faria dele alguém que
// enxerga o trabalho e não consegue pedir nada a ninguém.
// ============================================================

import { hasMinRole, type AccountRole } from '@/lib/auth/roles';
import type { Task } from '@/types';

export type AcaoDeTarefa =
  | 'marcar-lida'
  | 'concluir'
  | 'importante'
  | 'editar'
  | 'apagar';

export interface AtorDaTarefa {
  /** `auth.users.id` de quem está agindo. */
  userId: string;
  papel: AccountRole;
}

/** Só o que decide a permissão — a rota tem a linha inteira, a tela também. */
export type TarefaParaPermissao = Pick<
  Task,
  'criador_user_id' | 'responsavel_user_id'
>;

/**
 * ⚠️ A REDE DE SEGURANÇA DO ADMIN existe por causa de um impasse real, o
 * mesmo que a 918 documenta nas anotações: `criador_user_id` e
 * `responsavel_user_id` são `ON DELETE SET NULL`. Quando alguém sai do
 * escritório, as tarefas dele ficam com as duas colunas nulas — e a
 * comparação `=== ator.userId` passa a ser falsa para TODO MUNDO. Sem esta
 * porta, a tarefa órfã fica encalhada na fila da conta para sempre, sem
 * ninguém capaz de concluí-la, editá-la ou apagá-la.
 */
function ehAdmin(ator: AtorDaTarefa): boolean {
  return hasMinRole(ator.papel, 'admin');
}

function ehResponsavel(t: TarefaParaPermissao, ator: AtorDaTarefa): boolean {
  // ⚠️ O teste de nulo é load-bearing: sem ele, uma tarefa cujo responsável
  // saiu (coluna NULA) casaria com um `userId` também nulo vindo de um
  // contexto sem sessão, e a permissão vazaria. `userId` é `string` no tipo,
  // mas esta função é chamada com dado que veio da rede.
  return !!t.responsavel_user_id && t.responsavel_user_id === ator.userId;
}

function ehCriador(t: TarefaParaPermissao, ator: AtorDaTarefa): boolean {
  return !!t.criador_user_id && t.criador_user_id === ator.userId;
}

/**
 * A decisão. Um `switch` fechado de propósito: acrescentar uma ação em
 * `AcaoDeTarefa` sem decidir quem pode fazê-la vira erro de typecheck, não um
 * `false` silencioso que ninguém percebe até o botão não funcionar.
 */
export function podeNaTarefa(
  acao: AcaoDeTarefa,
  tarefa: TarefaParaPermissao,
  ator: AtorDaTarefa,
): boolean {
  switch (acao) {
    // ⚠️ SÓ O RESPONSÁVEL, sem exceção nem para o admin. "Lida" é o estado
    // pessoal de quem recebeu — um terceiro marcando por ele apagaria
    // justamente o sinal de que a tarefa ainda não foi vista, que é a única
    // coisa que a etiqueta do menu conta.
    case 'marcar-lida':
      return ehResponsavel(tarefa, ator);

    // Os dois lados fecham a tarefa: quem fez, e quem pediu e já sabe que
    // está feito. Impedir o criador obrigaria a pedir a baixa por WhatsApp —
    // que é exatamente o que esta feature veio substituir.
    case 'concluir':
    case 'importante':
      return ehResponsavel(tarefa, ator) || ehCriador(tarefa, ator) || ehAdmin(ator);

    // ⚠️ O RESPONSÁVEL NÃO EDITA, e isso é o desenho. Mudar o texto, a data ou
    // para quem a tarefa aponta é reescrever o pedido; quem recebeu adiando o
    // próprio prazo esvazia a delegação. Quem recebeu e discorda responde
    // (que cria tarefa nova, visível) ou fala com quem pediu.
    case 'editar':
    case 'apagar':
      return ehCriador(tarefa, ator) || ehAdmin(ator);

    default: {
      // Exaustividade — mesmo padrão do `useCan`.
      const _exhaustive: never = acao;
      throw new Error(`Ação de tarefa desconhecida: ${String(_exhaustive)}`);
    }
  }
}
