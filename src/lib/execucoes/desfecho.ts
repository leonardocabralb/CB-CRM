// ============================================================
// O QUE APARECE NO FIO sobre execuções de automação (985) — puro, testável.
//
// O operador pediu para ver, junto das mensagens, quando uma automação falhou
// (com destaque) e quando concluiu (discreto). O risco desta feature não é
// técnico, é de PRODUTO: o fio virar log.
//
// Já aconteceu neste projeto. O Radar (941) nasceu mostrando toda conversa
// analisada e o operador mandou cortar — "7 dos 8 cartões eram resumo de
// conversa sem nada a tratar". A régua daqui é a mesma lição: mostrar o que
// muda uma decisão, colapsar o resto, e ter um teto.
//
// Medido em 2026-09-09, antes de existir: 15 execuções na conta, no máximo 7
// num contato só. Parece pouco — mas as oito automações do escritório entram
// agora, e a de no-show sozinha manda 10 mensagens ao longo de 90 dias. Uma
// automação de gatilho "mensagem recebida" conclui uma vez POR MENSAGEM do
// cliente: sem colapso, esta feature DOBRA o comprimento de um fio ativo.
// ============================================================

import type { AutomationLogDesfecho } from '@/types'
import type { AutomationLogStepResult } from '@/types'

/** Uma linha de `automation_logs` como o hook a lê. */
export interface ExecucaoEncerrada {
  id: string
  automationId: string
  /** Nome da automação; `null` quando ela foi apagada depois de rodar. */
  nomeDaAutomacao: string | null
  desfecho: AutomationLogDesfecho | null
  finalizadoEm: string | null
  errorMessage: string | null
  stepsExecuted: AutomationLogStepResult[] | null
  /**
   * A marca durável da interrupção (1005). Só a ABA a lê (`itensDoHistorico`):
   * o fio ignora a execução interrompida sem desfecho, de propósito.
   */
  interrompidaEm?: string | null
  interrompidaPor?: string | null
}

export interface ItemDeExecucao {
  /** Chave de render e de ordenação estável. */
  chave: string
  /** ISO de `finalizado_em` — é por ele que o item se intercala no fio. */
  quando: string
  desfecho: AutomationLogDesfecho
  /** Nome da automação, ou `null` se ela já não existe. */
  nome: string | null
  /**
   * Quantas execuções o item representa. > 1 quando o colapso agrupou
   * repetições do mesmo dia com o mesmo desfecho.
   */
  vezes: number
  /** A execução MAIS RECENTE do grupo — é ela que o clique abre. */
  execucaoId: string
  /** Tipo do passo que falhou, quando houve falha. */
  passoQueParou?: string
  /** Texto cru do motor. Só existe em falha; a tela decide onde mostrá-lo. */
  motivoBruto?: string
}

/**
 * Teto de itens por conversa.
 *
 * 12 é folgado para um dia de trabalho e curto o bastante para o fio não
 * virar log num cliente que já tem meses de histórico de automação.
 */
export const TETO_DE_ITENS = 12

/** `2026-08-30T19:00:00Z` → `2026-08-30` no fuso de QUEM LÊ. */
function diaLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const ano = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${ano}-${mes}-${dia}`
}

/**
 * O passo que PAROU a execução.
 *
 * ⚠️ Sai da entrada com `status: 'failed'`, NUNCA de `at(-1)`. O ramo de uma
 * condição faz seu próprio flush de dentro da recursão, antes de o escopo de
 * fora gravar o dele — então o último elemento do array não é o último passo
 * a rodar. Uma régua por `at(-1)` acerta no caso simples e erra exatamente
 * onde há ramo, que é onde o operador mais precisa da resposta.
 */
function passoQueFalhou(passos: AutomationLogStepResult[] | null): string | undefined {
  if (!Array.isArray(passos)) return undefined
  return passos.find((p) => p?.status === 'failed')?.step_type
}

/** A condição que desviou, para o aviso poder dizer QUAL barrou. */
function condicaoQueBarrou(passos: AutomationLogStepResult[] | null): string | undefined {
  if (!Array.isArray(passos)) return undefined
  const c = passos.find((p) => p?.step_type === 'condition' && p?.status === 'skipped')
  return c ? c.detail || undefined : undefined
}

/**
 * As execuções que merecem uma linha no fio, já colapsadas e ordenadas do mais
 * antigo para o mais novo (a ordem do fio).
 */
export function itensDoFio(
  linhas: readonly ExecucaoEncerrada[],
  opcoes: { teto?: number } = {},
): ItemDeExecucao[] {
  const teto = opcoes.teto ?? TETO_DE_ITENS

  // (a) ⚠️ Só execução que TERMINOU. Sem esta linha, o `status: 'failed'`
  // semeado no INSERT pintaria um cartão vermelho em toda automação que
  // apenas COMEÇOU — e a que está parada num "Aguardar" apareceria como
  // encerrada. Desfecho nulo é "não sei", e a tela cala sobre o que não sabe.
  const encerradas = linhas.filter(
    (l): l is ExecucaoEncerrada & { desfecho: AutomationLogDesfecho; finalizadoEm: string } =>
      Boolean(l && l.desfecho && l.finalizadoEm),
  )

  // (b) Colapso por (automação, dia local, desfecho). O sobrevivente é o mais
  // RECENTE do grupo, e `vezes` conta o resto.
  const grupos = new Map<string, { itens: typeof encerradas }>()
  for (const l of encerradas) {
    const chave = `${l.automationId}|${diaLocal(l.finalizadoEm)}|${l.desfecho}`
    const g = grupos.get(chave)
    if (g) g.itens.push(l)
    else grupos.set(chave, { itens: [l] })
  }

  const itens: ItemDeExecucao[] = []
  for (const [chave, g] of grupos) {
    const ordenadas = [...g.itens].sort((a, b) => (a.finalizadoEm < b.finalizadoEm ? 1 : -1))
    const mais = ordenadas[0]
    itens.push({
      chave,
      quando: mais.finalizadoEm,
      desfecho: mais.desfecho,
      nome: mais.nomeDaAutomacao,
      vezes: ordenadas.length,
      execucaoId: mais.id,
      // O motivo só acompanha a falha: numa execução concluída ele é ruído, e
      // numa barrada o texto útil é qual condição desviou.
      ...(mais.desfecho === 'falhou'
        ? {
            passoQueParou: passoQueFalhou(mais.stepsExecuted),
            motivoBruto: mais.errorMessage ?? undefined,
          }
        : {}),
      ...(mais.desfecho === 'barrada'
        ? { motivoBruto: condicaoQueBarrou(mais.stepsExecuted) }
        : {}),
    })
  }

  // (c) Ordem do fio (antigo → novo) e teto mantendo os MAIS RECENTES: o
  // histórico antigo é o que menos importa para quem está lendo a conversa.
  itens.sort((a, b) => (a.quando < b.quando ? -1 : a.quando > b.quando ? 1 : 0))
  return itens.length > teto ? itens.slice(itens.length - teto) : itens
}

// ============================================================
// O "JÁ RODOU" da aba Automações — a mesma régua do fio, com duas diferenças
// (pedido do operador, 29/09/2026: a mini-auditoria):
//
//   1. A execução INTERROMPIDA entra (o cliente respondeu durante a espera,
//      alguém clicou Parar, o card saiu da etapa, outra automação a parou, a
//      automação foi desligada). Sem desfecho — `interrompida_em` é a marca
//      durável (1005) e é ela que decide. Só na aba: no fio, cada resposta do
//      cliente a uma sequência viraria uma linha no meio da conversa, e o fio
//      não vira log (a lição do Radar, no topo deste arquivo).
//   2. O grupo guarda TODAS as execuções, não só a mais recente: expandida, a
//      linha deixa trocar entre elas.
//
// Ordem: da mais RECENTE para a mais antiga (a da aba).
// ============================================================

/** Os valores do CHECK de `automation_logs.interrompida_por` (1005). */
export type MotivoDaInterrupcao = 'resposta' | 'etapa' | 'parar' | 'passo' | 'desativacao'

export const MOTIVOS_DA_INTERRUPCAO: readonly MotivoDaInterrupcao[] = [
  'resposta',
  'etapa',
  'parar',
  'passo',
  'desativacao',
]

export type DesfechoDoHistorico = AutomationLogDesfecho | 'interrompida'

export interface ItemDoHistorico {
  chave: string
  /** Quando terminou (`finalizado_em`) ou foi interrompida (`interrompida_em`). */
  quando: string
  desfecho: DesfechoDoHistorico
  nome: string | null
  automationId: string
  /** As execuções do grupo, da mais recente para a mais antiga. `length` é o "N×". */
  execucoes: { id: string; quando: string }[]
  /** Tipo do passo que falhou, quando houve falha. */
  passoQueParou?: string
  /** Texto cru do motor: o erro, ou a condição que barrou. */
  motivoBruto?: string
  /** Por que parou, na interrompida. `null` = valor fora do CHECK (não sei). */
  interrompidaPor?: MotivoDaInterrupcao | null
}

/** Teto da aba: mais folgado que o do fio — aqui é auditoria, lá é conversa. */
export const TETO_DO_HISTORICO = 30

export function itensDoHistorico(
  linhas: readonly ExecucaoEncerrada[],
  opcoes: { teto?: number } = {},
): ItemDoHistorico[] {
  const teto = opcoes.teto ?? TETO_DO_HISTORICO

  const validas: { l: ExecucaoEncerrada; desfecho: DesfechoDoHistorico; quando: string }[] = []
  for (const l of linhas) {
    if (!l) continue
    // O desfecho vence: a interrompida que já tinha falhado num ramo antes
    // (a marca publica a hora de fim da falha adiada) é uma FALHA.
    if (l.desfecho && l.finalizadoEm) {
      validas.push({ l, desfecho: l.desfecho, quando: l.finalizadoEm })
    } else if (l.interrompidaEm) {
      validas.push({ l, desfecho: 'interrompida', quando: l.interrompidaEm })
    }
  }

  const grupos = new Map<string, typeof validas>()
  for (const v of validas) {
    const chave = `${v.l.automationId}|${diaLocal(v.quando)}|${v.desfecho}`
    const g = grupos.get(chave)
    if (g) g.push(v)
    else grupos.set(chave, [v])
  }

  const itens: ItemDoHistorico[] = []
  for (const [chave, g] of grupos) {
    const ordenadas = [...g].sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0))
    const mais = ordenadas[0]
    const motivo = mais.l.interrompidaPor
    itens.push({
      chave,
      quando: mais.quando,
      desfecho: mais.desfecho,
      nome: mais.l.nomeDaAutomacao,
      automationId: mais.l.automationId,
      execucoes: ordenadas.map((v) => ({ id: v.l.id, quando: v.quando })),
      ...(mais.desfecho === 'falhou'
        ? {
            passoQueParou: passoQueFalhou(mais.l.stepsExecuted),
            motivoBruto: mais.l.errorMessage ?? undefined,
          }
        : {}),
      ...(mais.desfecho === 'barrada'
        ? { motivoBruto: condicaoQueBarrou(mais.l.stepsExecuted) }
        : {}),
      ...(mais.desfecho === 'interrompida'
        ? {
            interrompidaPor: MOTIVOS_DA_INTERRUPCAO.includes(motivo as MotivoDaInterrupcao)
              ? (motivo as MotivoDaInterrupcao)
              : null,
          }
        : {}),
    })
  }

  itens.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0))
  return itens.slice(0, teto)
}
