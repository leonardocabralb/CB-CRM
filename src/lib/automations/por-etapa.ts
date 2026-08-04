import type { Automation, DealStageTriggerConfig } from '@/types'

/**
 * Quais automações valem para uma ETAPA do funil (Fase 5 — o painel por
 * coluna, no estilo Kommo).
 *
 * Puro e fora da tela de propósito: a resposta tem de ser a MESMA que o motor
 * dá, e a única forma de garantir isso é ter as duas regras escritas num lugar
 * só, com teste comparando com `triggerMatches`/`stageInScope`.
 *
 * ⚠️ São DUAS listas de etapa com significados opostos, e trocá-las é o erro
 * fácil aqui:
 *
 *   `trigger_config.stage_ids` → para qual etapa o card tem de ENTRAR
 *   `automation.stage_ids`     → em qual etapa o contato precisa ESTAR (escopo)
 *
 * Nas duas, vazio = TODAS, nunca "nenhuma" (convenção do projeto inteiro).
 */

/** Por que esta automação aparece — ou não dispara — nesta etapa. */
export type ClasseNaEtapa =
  /** O gatilho nomeia esta etapa. */
  | 'especifica'
  /** O gatilho está vazio: dispara em qualquer etapa, inclusive nesta. */
  | 'irrestrita'
  /**
   * O gatilho alcança esta etapa, mas o ESCOPO da automação não. Configurada,
   * visível e incapaz de disparar aqui.
   */
  | 'morta'
  /** Não tem nada com esta etapa. */
  | 'fora'

/**
 * ⚠️ Espelha `triggerMatches` (engine.ts) para `deal_stage_changed` e
 * `stageInScope` no caminho em que há etapa no contexto — que é sempre o caso
 * de um evento de funil. Há teste comparando as duas implementações; se o
 * motor mudar, ele quebra.
 */
export function classificarNaEtapa(a: Automation, stageId: string): ClasseNaEtapa {
  if (a.trigger_type !== 'deal_stage_changed') return 'fora'

  const alvo = (a.trigger_config as DealStageTriggerConfig | undefined)?.stage_ids
  const irrestrita = !Array.isArray(alvo) || alvo.length === 0
  if (!irrestrita && !alvo.includes(stageId)) return 'fora'

  // O escopo é avaliado com `to_stage_id` = esta etapa, porque é isso que o
  // evento de funil entrega ao motor. Vazio/nulo deixa passar.
  const escopo = a.stage_ids
  if (escopo && escopo.length > 0 && !escopo.includes(stageId)) return 'morta'

  return irrestrita ? 'irrestrita' : 'especifica'
}

export interface AutomacoesDaEtapa {
  /** O gatilho nomeia esta etapa. São as "automações desta coluna". */
  especificas: Automation[]
  /** Disparam em toda etapa. Aparecem em TODAS as colunas, de propósito. */
  irrestritas: Automation[]
  /** Gatilho alcança, escopo barra. Nunca dispara aqui. */
  mortas: Automation[]
}

export function automacoesDaEtapa(
  automations: Automation[],
  stageId: string,
): AutomacoesDaEtapa {
  const r: AutomacoesDaEtapa = { especificas: [], irrestritas: [], mortas: [] }
  for (const a of automations) {
    const classe = classificarNaEtapa(a, stageId)
    if (classe === 'especifica') r.especificas.push(a)
    else if (classe === 'irrestrita') r.irrestritas.push(a)
    else if (classe === 'morta') r.mortas.push(a)
  }
  return r
}

/**
 * O número da etiqueta na coluna.
 *
 * ⚠️ Conta só o que REALMENTE dispara e está LIGADO. Uma etiqueta que
 * contasse a automação pausada diria "3" numa coluna onde nada acontece — e
 * o operador procuraria defeito no motor. A morta fica de fora pelo mesmo
 * motivo; ela aparece dentro do painel, com o aviso.
 */
export function contarAtivasNaEtapa(automations: Automation[], stageId: string): number {
  const { especificas, irrestritas } = automacoesDaEtapa(automations, stageId)
  return [...especificas, ...irrestritas].filter((a) => a.is_active).length
}
