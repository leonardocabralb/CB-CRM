// ============================================================
// Tarefa VISTA (1068) — a régua pura de "esta aparição conta?".
//
// Decisão do operador (29/09/2026): a tarefa conta como vista quando fica
// visível na tela do RESPONSÁVEL por um instante — na lista de Tarefas, na
// ficha, na conversa ou no Meu dia. Na primeira vez a rota grava `vista_em`
// e, se ainda não lida, `lida_em`. Não existe tela de detalhe da tarefa: a
// linha JÁ é a tarefa inteira (título, descrição, prazo, cliente).
//
// ⚠️ Esta régua é o FILTRO DO NAVEGADOR, não a barreira: quem decide é a
// consulta da rota (`responsavel_user_id = quem chama`, aberta, ainda não
// vista). Aqui ela só evita mandar à rota o que ela recusaria.
// ============================================================

import type { Task } from '@/types';

import { ehUuid } from './validar';

/** Quanto tempo a linha precisa ficar na tela para contar como vista. */
export const TEMPO_NA_TELA_MS = 1_000;

/**
 * Quanto da linha precisa estar à vista. Mais da metade: a linha cortada na
 * borda da rolagem, com o título escondido, não foi lida por ninguém.
 */
export const FRACAO_VISIVEL = 0.6;

/** Teto de ids por pedido — a lista de Tarefas põe dezenas na tela de uma vez. */
export const IDS_POR_PEDIDO = 100;

export type TarefaParaVista = Pick<
  Task,
  'responsavel_user_id' | 'status' | 'vista_em'
>;

/**
 * A aparição desta tarefa na tela de `userId` conta como "vista"?
 *
 * Só quando a pessoa é a RESPONSÁVEL (o admin ou quem pediu olhando a fila
 * não "viu" por ela — é justamente o que o gestor quer saber), a tarefa está
 * aberta e ainda não foi vista (a primeira vez é o registro; as seguintes não
 * mudam nada).
 */
export function contaComoVista(
  tarefa: TarefaParaVista,
  userId: string | null,
): boolean {
  return (
    !!userId &&
    !!tarefa.responsavel_user_id &&
    tarefa.responsavel_user_id === userId &&
    tarefa.status === 'aberta' &&
    !tarefa.vista_em
  );
}

/**
 * O corpo da rota, em PARSE: lista não vazia de UUIDs, sem repetição, até o
 * teto. `null` = corpo inválido (a rota responde 400). Id malformado recusa o
 * pedido inteiro — o navegador só manda o que leu da tabela, então um id
 * estranho é defeito, não dado.
 */
export function idsDoPedido(corpo: unknown): string[] | null {
  const ids = (corpo as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (!ids.every(ehUuid)) return null;
  const unicos = [...new Set(ids)];
  if (unicos.length > IDS_POR_PEDIDO) return null;
  return unicos;
}
