// ============================================================
// Esperas de automação agrupadas por automação — puro, testável.
//
// A aba Automações da conversa lista o que está AGENDADO para acontecer com
// o cliente: cada passo "Aguardar" pendente é uma linha em
// `automation_pending_executions` (status='pending', run_at no futuro). A
// tela não mostra a linha crua — mostra A AUTOMAÇÃO, com a próxima batida e
// quantas esperas existem, porque é nesse grão que o operador decide parar
// (e é nesse grão que o motor cancela: o passo `stop_automation` corta por
// automação+contato, nunca por espera individual).
//
// ⚠️ O embed `automations(name)` do PostgREST devolve OBJETO na FK to-one,
// mas o tipo do cliente não garante isso — trate as duas formas. `null` =
// automação sumiu no meio do caminho (FK é CASCADE, então é janela curta de
// corrida); a tela imprime "(apagada)", nunca o UUID — convenção da casa.
// ============================================================

/** Linha crua da consulta (service-role) sobre `automation_pending_executions`. */
export interface EsperaPendente {
  id: string
  automation_id: string
  /** Quando o cron vai acordar esta espera (timestamptz ISO). */
  run_at: string
  /** Embed do PostgREST — objeto na prática, mas defenda-se das duas formas. */
  automations?: { name: string | null } | { name: string | null }[] | null
  /** Onde a execução retoma — alimenta a linha do tempo da mini-expansão. */
  next_step_position?: number
  parent_step_id?: string | null
  branch?: 'yes' | 'no' | null
  log_id?: string | null
}

/** A espera que a linha do tempo detalha (a mais próxima de acordar). */
export interface ReferenciaDaEspera {
  next_step_position: number
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  log_id: string | null
}

/** Uma automação com pelo menos uma espera pendente para o contato. */
export interface EsperaAgrupada {
  automationId: string
  /** Nome da automação; null quando o embed não veio (automação apagada). */
  nome: string | null
  /** A espera mais PRÓXIMA de acordar (menor run_at), ISO. */
  proximaEm: string
  /** Quantas esperas pendentes esta automação tem para o contato. */
  esperas: number
  /** Escopo/log da espera de `proximaEm` — é ELA que a expansão conta. */
  referencia?: ReferenciaDaEspera
}

function nomeDoEmbed(e: EsperaPendente): string | null {
  const raw = e.automations
  if (!raw) return null
  const obj = Array.isArray(raw) ? raw[0] : raw
  return obj?.name ?? null
}

function referenciaDe(e: EsperaPendente): ReferenciaDaEspera | undefined {
  if (typeof e.next_step_position !== 'number') return undefined
  return {
    next_step_position: e.next_step_position,
    parent_step_id: e.parent_step_id ?? null,
    branch: e.branch ?? null,
    log_id: e.log_id ?? null,
  }
}

/**
 * Agrupa por automação e ordena pela próxima batida (a mais iminente
 * primeiro) — é ela que o operador precisa alcançar antes que dispare.
 */
export function agruparEsperas(linhas: EsperaPendente[]): EsperaAgrupada[] {
  const porAutomacao = new Map<string, EsperaAgrupada>()

  for (const linha of linhas) {
    const atual = porAutomacao.get(linha.automation_id)
    if (!atual) {
      porAutomacao.set(linha.automation_id, {
        automationId: linha.automation_id,
        nome: nomeDoEmbed(linha),
        proximaEm: linha.run_at,
        esperas: 1,
        referencia: referenciaDe(linha),
      })
      continue
    }
    atual.esperas += 1
    if (new Date(linha.run_at).getTime() < new Date(atual.proximaEm).getTime()) {
      // A referência anda JUNTO com a proximaEm: a expansão detalha a espera
      // que o operador está vendo, não uma irmã de outra data.
      atual.proximaEm = linha.run_at
      atual.referencia = referenciaDe(linha)
    }
    // O nome pode ter vindo só em parte das linhas (corrida com a exclusão).
    if (atual.nome === null) atual.nome = nomeDoEmbed(linha)
  }

  return [...porAutomacao.values()].sort(
    (a, b) => new Date(a.proximaEm).getTime() - new Date(b.proximaEm).getTime(),
  )
}
