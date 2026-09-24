// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  /**
   * ⚠️ `null` = NÃO SABEMOS. A leitura dos negócios abertos percorre milhares
   * de linhas e pode voltar incompleta (teto de páginas, consulta recusada,
   * coleção mudando no meio); nesse caso o cartão ESCONDE o número em vez de
   * publicar a soma parcial. Soma parcial apresentada como total é plausível,
   * estável entre recarregamentos e menor que a verdade — ninguém desconfia.
   * Os dois campos andam juntos: ou se sabe o valor e a contagem, ou nenhum.
   */
  openDeals: { value: number; count: number } | null
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutSlices {
  stages: PipelineStageSlice[]
  totalValue: number
}

/**
 * ⚠️ `confiavel: false` = NÃO SABEMOS: a leitura dos negócios (ou das etapas)
 * não voltou completa. É união discriminada, e não campos anuláveis, para o
 * compilador COBRAR o caso de quem desenhar a rosca — desenhá-la com metade
 * dos negócios daria um anel bonito, com todas as fatias menores que a
 * verdade e nada na tela dizendo isso.
 */
export type PipelineDonutData =
  | ({ confiavel: true } & PipelineDonutSlices)
  | { confiavel: false }

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

interface ActivityBase {
  id: string
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}

/**
 * Uma linha do feed, em DADO — a frase é montada na TELA, pelo dicionário
 * (`Dashboard.activityFeed.eventos.*`, em `activity-feed.tsx`). Até a Fase
 * 10 do merge do upstream a consulta devolvia a frase pronta, em inglês
 * ("New message from …", "Automation … triggered for …"), e o Painel
 * mostrava o feed inteiro em inglês. `null` num nome = não se sabe quem: a
 * tela escreve o texto de queda traduzido.
 */
export type ActivityItem = ActivityBase &
  (
    | { kind: 'message'; quem: string | null }
    | { kind: 'contact'; quem: string | null }
    | { kind: 'deal'; titulo: string; etapa: string | null }
    | { kind: 'broadcast'; nome: string; status: string; total: number }
    | { kind: 'automation'; automacao: string | null; falhou: boolean; quem: string | null }
  )
