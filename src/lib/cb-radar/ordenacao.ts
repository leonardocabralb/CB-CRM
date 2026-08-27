// ============================================================
// Ordenação e agregação do painel — a resposta a "qual conversa eu olho
// primeiro?". Pura, para o teste fixar as regras de desempate.
//
// A severidade é um score aberto (documentado abaixo) em vez de regras
// encadeadas: o operador precisa que "urgência alta de 4 dias atrás"
// ganhe de "conversa recente sem nada", e um score soma esses fatores de
// forma explicável. A prioridade das últimas 72h (pedido do produto)
// entra como BÔNUS, não como corte: recente sobe, antigo não some.
// ============================================================

export type Urgencia = 'nenhuma' | 'baixa' | 'media' | 'alta'
export type EstadoDoInsight = 'aberto' | 'tratado' | 'descartado'

/** Abaixo disso, "aguardando resposta" ainda não é pendência — meia hora
 *  útil de fila é operação normal, não sinal. */
export const LIMIAR_PENDENCIA_SEG = 30 * 60

const MS_72H = 72 * 3_600_000

export interface InsightParaOrdenacao {
  urgencia: Urgencia
  insatisfacao: boolean
  pedidosAbertos: number
  /** Segundos ÚTEIS aguardando resposta AGORA (o chamador calcula ao
   *  vivo com `segundosUteisEntre` — o valor gravado no banco envelhece). */
  aguardandoSegUteis: number | null
  nota: number | null
  estado: EstadoDoInsight
  ultimaAtividade: Date | null
}

export function pontuacaoDeSeveridade(i: InsightParaOrdenacao, agora: Date): number {
  let score = 0
  if (i.urgencia === 'alta') score += 100
  else if (i.urgencia === 'media') score += 60
  else if (i.urgencia === 'baixa') score += 30

  if (i.insatisfacao) score += 40
  score += Math.min(i.pedidosAbertos, 3) * 15

  const aguardando = i.aguardandoSegUteis ?? 0
  if (aguardando >= 4 * 3600) score += 50
  else if (aguardando >= 3600) score += 25
  else if (aguardando >= LIMIAR_PENDENCIA_SEG) score += 10

  if (i.nota !== null) {
    if (i.nota <= 4) score += 20
    else if (i.nota <= 6) score += 10
  }

  // Prioridade às últimas 72h: bônus, nunca critério de corte.
  const atividade = i.ultimaAtividade?.getTime()
  if (atividade && agora.getTime() - atividade <= MS_72H) score += 15

  return score
}

/**
 * Mais grave primeiro; empate vai para a atividade mais recente.
 * Tratado/descartado caem para depois de todo aberto — continuam
 * visíveis (na aba "todos"), mas nunca acima do que ainda pede ação.
 */
export function ordenarPorSeveridade<T>(
  itens: T[],
  chave: (t: T) => InsightParaOrdenacao,
  agora: Date,
): T[] {
  const rank = (e: EstadoDoInsight) => (e === 'aberto' ? 0 : 1)
  return [...itens].sort((a, b) => {
    const ia = chave(a)
    const ib = chave(b)
    if (rank(ia.estado) !== rank(ib.estado)) return rank(ia.estado) - rank(ib.estado)
    const diff = pontuacaoDeSeveridade(ib, agora) - pontuacaoDeSeveridade(ia, agora)
    if (diff !== 0) return diff
    return (ib.ultimaAtividade?.getTime() ?? 0) - (ia.ultimaAtividade?.getTime() ?? 0)
  })
}

export interface CartoesDoRadar {
  /** Urgências (média/alta) ainda abertas. */
  urgencias: number
  /** Insatisfações ainda abertas. */
  insatisfacoes: number
  /** Conversas abertas com cliente aguardando acima do limiar. */
  pendencias: number
  /** Média das notas da janela (todas as analisadas, tratadas ou não —
   *  a qualidade da semana não muda porque alguém clicou em "tratado"). */
  notaMedia: number | null
}

export function resumirCartoes(itens: InsightParaOrdenacao[]): CartoesDoRadar {
  const abertos = itens.filter((i) => i.estado === 'aberto')
  const notas = itens.map((i) => i.nota).filter((n): n is number => n !== null)
  return {
    urgencias: abertos.filter((i) => i.urgencia === 'alta' || i.urgencia === 'media')
      .length,
    insatisfacoes: abertos.filter((i) => i.insatisfacao).length,
    pendencias: abertos.filter(
      (i) => (i.aguardandoSegUteis ?? 0) >= LIMIAR_PENDENCIA_SEG,
    ).length,
    notaMedia:
      notas.length > 0
        ? Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10
        : null,
  }
}
