// ============================================================
// A conferência de LIGAR uma automação, rodada no NAVEGADOR antes de salvar.
//
// As rotas (`/api/automations` e `/api/automations/[id]`) recusam ligar uma
// automação com pendência e devolvem as `issues` num 400. O construtor passou
// a rodar a MESMA conferência antes de mandar o pedido (29/09/2026, pedido do
// operador): assim ele marca em vermelho o passo com pendência sem depender da
// ida ao servidor, e a marca se apaga sozinha, AO VIVO, conforme o operador
// corrige. A régua continua sendo `validate.ts` — este módulo só junta as
// cinco funções na mesma ordem das rotas, para a tela e o servidor não
// divergirem.
//
// ⚠️ Mudou a lista de validações de uma rota? Mude aqui também:
// `conferir-para-ligar.test.ts` compara os nomes chamados nos três arquivos e
// reprova a divergência. A que escapar mesmo assim não some — o servidor
// recusa, e a tela mostra as pendências DELE (a "divergência").
//
// Puro: quem chama passa as listas que a tela carregou, e `null` onde a lista
// ainda não chegou ou falhou — aí a conferência daquela parte é PULADA (nunca
// "a conta não tem canal", que afirmaria ausência sobre dado não carregado).
// ============================================================

import type { CustomField } from '@/types'
import { opcoesDoCampo } from '@/lib/contacts/campo-opcoes'
import type { CampoParaCondicao } from './condicao-por-campo'
import {
  validateAsaasReguaForActivation,
  validateChannelScopeForActivation,
  validateCustomFieldConditionsForActivation,
  validateStepsForActivation,
  validateTriggerForActivation,
  type ChannelForValidation,
  type ValidationIssue,
} from './validate'

/** O passo na forma que vai no salvamento (`toApiSteps` do construtor). */
export interface PassoParaConferir {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: PassoParaConferir[]; no?: PassoParaConferir[] }
}

export interface ConferenciaParaLigar {
  triggerType: string
  triggerConfig: Record<string, unknown> | null | undefined
  /** O escopo de canal da automação; vazio ou `null` = todos (a regra da rota). */
  channelIds: string[] | null
  steps: PassoParaConferir[]
  /** As conexões da conta; `null` = não carregou — a conferência de canal é pulada. */
  canais: ChannelForValidation[] | null
  /**
   * Os campos personalizados DESTA conta, por id (`camposParaConferir`);
   * `null` = não carregou — a conferência da condição por campo é pulada,
   * como a rota faz quando a leitura dela falha.
   */
  campos: ReadonlyMap<string, CampoParaCondicao> | null
}

/**
 * As pendências que impedem ligar, na MESMA ordem das rotas (gatilho, passos,
 * régua do Asaas, canal, condição por campo) — a ordem é a das linhas do
 * painel e do toast.
 */
export function conferirParaLigar(a: ConferenciaParaLigar): ValidationIssue[] {
  const escopo = a.channelIds && a.channelIds.length > 0 ? a.channelIds : null
  return [
    ...validateTriggerForActivation(a.triggerType, a.triggerConfig ?? {}),
    ...validateStepsForActivation(a.steps),
    ...validateAsaasReguaForActivation(a.triggerType, a.steps),
    ...(a.canais ? validateChannelScopeForActivation(a.steps, escopo, a.canais) : []),
    ...validateCustomFieldConditionsForActivation(a.steps, a.campos),
  ]
}

/**
 * O mapa de campos que `validateCustomFieldConditionsForActivation` espera,
 * a partir da lista que a tela carregou — só os da CONTA (`contaId`): a
 * leitura do navegador devolve os campos de toda conta de que a pessoa é
 * membro (policy da 1032), e o servidor confere contra a conta da automação.
 * Sem conta conhecida, `null` (a conferência é pulada).
 */
export function camposParaConferir(
  campos: readonly CustomField[],
  contaId: string | null,
): Map<string, CampoParaCondicao> | null {
  if (!contaId) return null
  return new Map(
    campos
      .filter((c) => c.account_id === contaId)
      .map((c) => [
        c.id,
        { field_name: c.field_name, field_type: c.field_type, opcoes: opcoesDoCampo(c) },
      ]),
  )
}
