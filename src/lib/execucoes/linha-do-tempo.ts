// ============================================================
// Linha do tempo de UMA execução parada em "Aguardar" — puro, testável.
//
// A mini-expansão da aba Automações responde as quatro perguntas do
// operador: o que JÁ rodou, onde a execução ESTÁ, o que vem DEPOIS e o que
// falhou/pulou no caminho. As fontes são as que o motor já grava:
//
//   feitos    — `automation_logs.steps_executed` (cada entrada tem step_id,
//               status e o detalhe em texto do motor);
//   atual     — a própria espera (`run_at` — a tela já formata "acorda em X");
//   próximos  — `automation_steps` do MESMO escopo da espera (mesmo
//               parent/branch), de `next_step_position` em diante.
//
// ⚠️ Passo futuro dentro de RAMO de condição não é listado: qual ramo vai
// rodar depende de dado que só existe na hora. A linha mostra a condição em
// si, marcada `condicional` — afirmar um ramo seria a grade do funil
// mentindo de novo (o cartão que atravessa etapa que não vale).
//
// Os rótulos saem de `descreverPasso` (chave + valores, nunca texto pronto)
// — o mesmo contrato, e o mesmo teste, do resumo da grade do funil.
// ============================================================

import {
  descreverPasso,
  type NomesConhecidos,
} from '@/lib/automations/descrever-passo'

/** Linha crua de `automation_steps`, como o GET a entrega. */
export interface PassoDaAutomacao {
  id: string
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  step_type: string
  step_config?: unknown
  position: number
}

/** Entrada de `automation_logs.steps_executed` (AutomationLogStepResult). */
export interface PassoExecutado {
  step_id: string
  step_type: string
  status: 'success' | 'skipped' | 'failed'
  detail?: string
}

/** Onde a execução está parada — vem da linha de `pending_executions`. */
export interface EsperaDeReferencia {
  next_step_position: number
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
}

export interface ItemDaLinha {
  /** step_id (feitos) ou id do passo (próximos) — chave de render. */
  id: string
  estado: 'feito' | 'pulado' | 'falhou' | 'futuro' | 'condicional'
  /** Sufixo de `Pipelines.automacoes.resumo.*`. */
  chave: string
  valores: Record<string, string | number>
  alvoSumiu: boolean
  /** Texto do motor ("espera agendada…", "webhook 200") — só nos feitos. */
  detalhe?: string
}

export interface LinhaDoTempo {
  feitos: ItemDaLinha[]
  proximos: ItemDaLinha[]
}

const ESTADO_POR_STATUS = {
  success: 'feito',
  skipped: 'pulado',
  failed: 'falhou',
} as const

export function montarLinhaDoTempo(args: {
  passos: PassoDaAutomacao[]
  espera: EsperaDeReferencia
  executados: PassoExecutado[]
  nomes?: NomesConhecidos
}): LinhaDoTempo {
  const { passos, espera, executados, nomes = {} } = args
  const porId = new Map(passos.map((p) => [p.id, p]))

  const feitos: ItemDaLinha[] = executados.map((e, i) => {
    // O passo pode ter sido editado/apagado depois de rodar — o log é a
    // fotografia; o rótulo cai para o tipo, sem config, em vez de sumir.
    const passo = porId.get(e.step_id) ?? { step_type: e.step_type }
    const resumo = descreverPasso(passo, nomes)
    return {
      id: `${e.step_id}-${i}`,
      estado: ESTADO_POR_STATUS[e.status] ?? 'feito',
      chave: resumo.chave,
      valores: resumo.valores,
      alvoSumiu: resumo.alvoSumiu,
      detalhe: e.detail,
    }
  })

  const proximos: ItemDaLinha[] = passos
    .filter(
      (p) =>
        p.parent_step_id === espera.parent_step_id &&
        p.branch === espera.branch &&
        p.position >= espera.next_step_position,
    )
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      const resumo = descreverPasso(p, nomes)
      return {
        id: p.id,
        estado: p.step_type === 'condition' ? 'condicional' : 'futuro',
        chave: resumo.chave,
        valores: resumo.valores,
        alvoSumiu: resumo.alvoSumiu,
      } satisfies ItemDaLinha
    })

  return { feitos, proximos }
}
