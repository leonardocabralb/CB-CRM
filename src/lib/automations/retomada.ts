// ============================================================
// ONDE uma espera retoma depois que a automação foi EDITADA (26/09/2026).
//
// A fila (`automation_pending_executions`) guarda o escopo da espera
// (`parent_step_id` + `branch`) e a POSIÇÃO do próximo passo
// (`next_step_position`). As duas coisas envelhecem quando o operador salva a
// automação com execuções paradas num "Aguardar":
//
// - `parent_step_id` tem FK `ON DELETE SET NULL` para `automation_steps`
//   (0006). A condição apagada zera a coluna, e a retomada rodava o escopo de
//   FORA a partir daquela posição — outro passo, possivelmente outra mensagem
//   ao cliente. Até 26/09 TODO salvamento apagava e recriava os passos com ids
//   novos, então a espera dentro de ramo SEMPRE caía no escopo de fora (medido
//   no e2e). `replaceSteps` (`steps-tree.ts`) passou a preservar a identidade
//   dos passos que continuam existindo; aqui fica a outra ponta.
// - A posição é um ÍNDICE no escopo: inserir ou remover um passo ANTES da
//   espera desloca todo mundo, e a retomada repetia o "Aguardar" ou pulava a
//   mensagem seguinte da cadência — em silêncio.
//
// Por isso os DOIS estacionamentos do motor (o "Aguardar" e a retentativa)
// gravam no contexto QUAL passo estacionou — id e posição naquele instante —,
// e a retomada o procura: achou no MESMO escopo, retoma pela posição ATUAL
// dele; sumiu, ou mudou de escopo → falha VISÍVEL, com o motivo escrito no
// registro. Nunca seguir por outro caminho em silêncio.
//
// ⚠️ A chave NÃO é tirada do contexto na retomada (ao contrário da marca do
// "parar se responder"): os dois estacionamentos a REESCREVEM sempre, e só a
// retomada a lê — do contexto GRAVADO da linha que ela mesma está retomando.
// Uma cópia velha viajando no contexto vivo nunca chega a ser lida.
//
// Espera gravada por código anterior (sem a chave) retoma pela posição, como
// sempre foi — só a conferência do ramo apagado vale para ela.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

/** Sublinhado inicial: a convenção das chaves internas do contexto. */
export const CHAVE_DO_PASSO_DA_FILA = '_passo_da_fila';

/** O passo que estacionou, como estava NO INSTANTE do estacionamento. */
export interface PassoDaFila {
  id: string;
  pos: number;
}

// Textos do registro da execução (histórico da automação, aba Automações da
// conversa). Português no código, como os outros motivos do motor
// (`MOTIVO_ETAPA_DESCONHECIDA`): o motivo cru não vai para o fio.
export const MOTIVO_RAMO_REMOVIDO =
  'a condição em cujo ramo esta execução esperava foi removida ao editar a automação — ela não retomou, para não seguir por outro caminho';
export const MOTIVO_PASSO_REMOVIDO =
  'o passo em que esta execução esperava foi removido ao editar a automação — ela não retomou, para não seguir por outro caminho';
export const MOTIVO_PASSO_MOVIDO =
  'o passo em que esta execução esperava foi levado para outro ramo ao editar a automação — ela não retomou, para não seguir por outro caminho';
export const MOTIVO_PASSO_NAO_CONFERIDO =
  'não consegui conferir o passo em que esta execução esperava — ela não retomou, para não seguir por outro caminho';

/** O contexto a gravar na fila: o de sempre, mais o passo que estaciona. */
export function comPassoDaFila<T extends object>(
  context: T,
  passo: { id: string; position: number }
): T {
  return {
    ...context,
    [CHAVE_DO_PASSO_DA_FILA]: { id: passo.id, pos: passo.position },
  };
}

/**
 * Lê a chave do contexto GRAVADO. Parse, nunca `as`: o contexto é JSONB e a
 * forma estranha vale "não sei" — cai na retomada pela posição, a de sempre.
 */
export function lerPassoDaFila(context: unknown): PassoDaFila | null {
  if (!context || typeof context !== 'object') return null;
  const valor = (context as Record<string, unknown>)[CHAVE_DO_PASSO_DA_FILA];
  if (!valor || typeof valor !== 'object') return null;
  const { id, pos } = valor as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 0) return null;
  return { id, pos };
}

/** A linha da fila, no que a decisão precisa. */
export interface EsperaNaFila {
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  next_step_position: number;
  context: unknown;
}

/** O passo que estacionou, como está AGORA no banco (`null` = não existe mais). */
export interface PassoAgora {
  parent_step_id: string | null;
  branch: 'yes' | 'no' | null;
  position: number;
}

/** Ramo sem condição: só a FK `ON DELETE SET NULL` produz esta combinação. */
function ramoOrfao(espera: EsperaNaFila): boolean {
  return (espera.branch ?? null) !== null && (espera.parent_step_id ?? null) === null;
}

export type Retomada =
  | { tipo: 'segue'; posicao: number }
  | { tipo: 'parar'; motivo: string; passoId: string | null };

/**
 * A régua, pura.
 *
 * ⚠️ "Ramo sem condição" (`branch` preenchido e `parent_step_id` nulo) só
 * existe de um jeito: a FK `ON DELETE SET NULL` apagou o pai. A espera do
 * escopo de fora nasce com os DOIS nulos (`executeAutomation`), então a
 * combinação não é ambígua — e vale também para a linha sem a chave.
 */
export function decidirRetomada(
  espera: EsperaNaFila,
  gravado: PassoDaFila | null,
  agora: PassoAgora | null
): Retomada {
  if (ramoOrfao(espera)) {
    return { tipo: 'parar', motivo: MOTIVO_RAMO_REMOVIDO, passoId: gravado?.id ?? null };
  }
  if (!gravado) return { tipo: 'segue', posicao: espera.next_step_position };
  if (!agora) return { tipo: 'parar', motivo: MOTIVO_PASSO_REMOVIDO, passoId: gravado.id };
  if (
    (agora.parent_step_id ?? null) !== (espera.parent_step_id ?? null) ||
    (agora.branch ?? null) !== (espera.branch ?? null)
  ) {
    return { tipo: 'parar', motivo: MOTIVO_PASSO_MOVIDO, passoId: gravado.id };
  }
  // O "Aguardar" enfileira a posição SEGUINTE (+1); a retentativa, a do
  // próprio passo (+0). O deslocamento gravado viaja intacto: o que muda é só
  // onde o passo está agora.
  return {
    tipo: 'segue',
    posicao: agora.position + (espera.next_step_position - gravado.pos),
  };
}

/**
 * Onde retomar esta espera — ou por que não retomar. Nunca lança: roda na
 * retomada, fora do `try` do motor.
 *
 * ⚠️ Leitura que FALHA é `parar` (falha visível), nunca "segue pela posição":
 * seguir às cegas é exatamente o caminho errado em silêncio que isto existe
 * para impedir — o mesmo trato da conferência de etapa.
 */
export async function conferirRetomada(
  db: SupabaseClient,
  automationId: string,
  espera: EsperaNaFila
): Promise<Retomada> {
  const gravado = lerPassoDaFila(espera.context);
  if (!gravado || ramoOrfao(espera)) return decidirRetomada(espera, gravado, null);
  try {
    const { data, error } = await db
      .from('automation_steps')
      .select('parent_step_id, branch, position')
      .eq('automation_id', automationId)
      .eq('id', gravado.id)
      .maybeSingle();
    if (error) {
      console.error('[automations] conferirRetomada falhou:', error.message);
      return { tipo: 'parar', motivo: MOTIVO_PASSO_NAO_CONFERIDO, passoId: gravado.id };
    }
    return decidirRetomada(espera, gravado, (data as PassoAgora | null) ?? null);
  } catch (err) {
    console.error('[automations] conferirRetomada estourou:', err);
    return { tipo: 'parar', motivo: MOTIVO_PASSO_NAO_CONFERIDO, passoId: gravado.id };
  }
}
