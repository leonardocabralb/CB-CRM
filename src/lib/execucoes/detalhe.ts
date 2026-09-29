// ============================================================
// O DETALHE de uma execução que já terminou — puro, testável.
//
// O "Já rodou" da aba Automações dizia só "rodou, quebrou, não terminou"
// (pedido do operador, 29/09/2026: a mini-auditoria). Expandida, a linha
// responde: o que foi feito, na ordem; onde parou e por quê; e o que NÃO
// chegou a rodar por causa disso.
//
// Fontes, todas já gravadas pelo motor:
//   feitos      — `automation_logs.steps_executed` (a fotografia do que rodou);
//   o plano     — `automation_steps` da automação, como está HOJE;
//   onde parou  — o passo `failed`, ou a espera da fila que foi cancelada
//                 (interrompida) ou que falhou ao acordar.
//
// ⚠️ "Não rodaram" é a lista dos passos do plano que ficaram DEPOIS do ponto
// de parada e que NÃO aparecem no registro desta execução. Os dois recortes
// são necessários:
//   - "depois do ponto" sobe do escopo do passo até a raiz: passo que falha
//     dentro de um ramo encerra a execução inteira (`automacoes.md`), então o
//     que vinha depois da condição também não rodou;
//   - "não aparece no registro" porque um "Aguardar" dentro de ramo NÃO segura
//     o escopo de fora — os passos depois da condição podem já ter rodado
//     antes de a espera do ramo acordar e falhar. Listá-los seria mentira.
// Passo dentro de RAMO de uma condição que não rodou fica de fora (a condição
// aparece, marcada "depende da condição"): afirmar um ramo seria mentir — a
// mesma régua da linha do tempo de quem está aguardando.
//
// ⚠️ O plano é o de HOJE. Se o ponto de parada não existe mais (a automação
// foi editada depois), a lista não é montada: `naoRodaramDesconhecido`.
// ============================================================

import { descreverPasso, type NomesConhecidos } from '@/lib/automations/descrever-passo'
import { DETALHE_DA_INTERRUPCAO } from '@/lib/automations/parar-se-responder'
import { decidirRetomada, lerPassoDaFila } from '@/lib/automations/retomada'
import { DETALHE_SAIU_DA_ETAPA } from '@/lib/automations/so-na-etapa'
import type { DesfechoDoHistorico } from './desfecho'
import type { PassoDaAutomacao, PassoExecutado } from './linha-do-tempo'
import { ehAvisoDeTentativa } from './texto-do-motor'

/** Uma linha da fila de esperas desta execução, encerrada (cancelada ou que falhou). */
export interface EsperaEncerrada {
  parent_step_id: string | null
  branch: 'yes' | 'no' | null
  next_step_position: number
  context: unknown
}

export interface PassoDoDetalhe {
  /** Chave de render (`step_id` + índice: o mesmo passo roda mais de uma vez na retentativa). */
  id: string
  estado: 'feito' | 'pulado' | 'falhou' | 'tentativa'
  /** O `step_type` — decide o rótulo do id órfão no texto (`textoComNomes`). */
  tipo: string
  /** Sufixo de `Pipelines.automacoes.resumo.*`. */
  chave: string
  valores: Record<string, string | number>
  alvoSumiu: boolean
  /** O texto CRU do motor; a tela troca id por nome e traduz. */
  detalhe?: string
  /** Este é o passo em que a execução PAROU (a falha que a encerrou). */
  parou?: true
  /**
   * Linha do MOTOR, não de um passo (`step_id` vazio): a conferência ao
   * acordar ou ao nascer que parou a execução. O tipo gravado (`wait`) não
   * descreve nada — a tela usa um rótulo próprio.
   */
  doMotor?: true
}

export interface PassoQueNaoRodou {
  id: string
  estado: 'futuro' | 'condicional'
  chave: string
  valores: Record<string, string | number>
  alvoSumiu: boolean
}

export interface DetalheMontado {
  passos: PassoDoDetalhe[]
  /** `null` = não se aplica (concluída, barrada) ou não há ponto de parada conhecido. */
  naoRodaram: PassoQueNaoRodou[] | null
  /** O ponto de parada sumiu da automação (editada depois): a lista não é afirmada. */
  naoRodaramDesconhecido?: true
}

const ESTADO_POR_STATUS = { success: 'feito', skipped: 'pulado', failed: 'falhou' } as const

/**
 * Textos das anotações de interrupção (`interrupcao.ts`): a tela diz o motivo
 * no rodapé, a partir de `interrompida_por`; repetir a anotação como "passo"
 * pularia um "Aguardar" que não foi pulado.
 */
const ANOTACOES = new Set<string>([DETALHE_DA_INTERRUPCAO, DETALHE_SAIU_DA_ETAPA])

/**
 * O que o registro diz que RODOU. `skipped` só conta na condição (ela avaliou e
 * desviou); nos outros é "não executado: …", "não estacionada: …" ou a
 * anotação — o passo NÃO rodou.
 */
function idsQueRodaram(executados: readonly PassoExecutado[]): Set<string> {
  const ids = new Set<string>()
  for (const e of executados) {
    if (!e?.step_id) continue
    if (e.status === 'skipped' && e.step_type !== 'condition') continue
    ids.add(e.step_id)
  }
  return ids
}

function paraNaoRodou(p: PassoDaAutomacao, nomes: NomesConhecidos): PassoQueNaoRodou {
  const resumo = descreverPasso(p, nomes)
  return {
    id: p.id,
    estado: p.step_type === 'condition' ? 'condicional' : 'futuro',
    chave: resumo.chave,
    valores: resumo.valores,
    alvoSumiu: resumo.alvoSumiu,
  }
}

interface Escopo {
  parent: string | null
  branch: 'yes' | 'no' | null
  /** A partir de qual posição (inclusive) o escopo conta. */
  desde: number
}

const doEscopo = (p: PassoDaAutomacao, parent: string | null, branch: 'yes' | 'no' | null) =>
  (p.parent_step_id ?? null) === parent && (p.branch ?? null) === branch

/**
 * Os passos do plano a partir de uma posição num escopo, subindo até a raiz:
 * no escopo, os de posição ≥ `desde`; em cada escopo de cima, os que vêm
 * DEPOIS da condição que contém o de baixo.
 */
function daquiEmDiante(
  passos: readonly PassoDaAutomacao[],
  porId: ReadonlyMap<string, PassoDaAutomacao>,
  escopo: Escopo,
): PassoDaAutomacao[] {
  const lista: PassoDaAutomacao[] = []
  let atual: Escopo | null = escopo
  // Teto de profundidade: um ciclo em `parent_step_id` (dado corrompido) não
  // pode travar a rota.
  for (let nivel = 0; atual && nivel < 50; nivel++) {
    const aqui: Escopo = atual
    lista.push(
      ...passos
        .filter((p) => doEscopo(p, aqui.parent, aqui.branch) && p.position >= aqui.desde)
        .sort((a, b) => a.position - b.position),
    )
    const condicao: PassoDaAutomacao | undefined = aqui.parent ? porId.get(aqui.parent) : undefined
    atual = condicao
      ? {
          parent: condicao.parent_step_id ?? null,
          branch: condicao.branch ?? null,
          desde: condicao.position + 1,
        }
      : null
  }
  return lista
}

/** A falha que ENCERROU a execução: a última `failed` que não é aviso de retentativa. */
function falhaQueParou(executados: readonly PassoExecutado[]): number {
  for (let i = executados.length - 1; i >= 0; i--) {
    const e = executados[i]
    if (e?.status === 'failed' && !ehAvisoDeTentativa(e.detail)) return i
  }
  return -1
}

export function montarDetalhe(args: {
  passos: readonly PassoDaAutomacao[]
  executados: readonly PassoExecutado[]
  desfecho: DesfechoDoHistorico
  /** As linhas da fila DESTA execução com status `cancelled` ou `failed`. */
  esperasEncerradas: readonly EsperaEncerrada[]
  nomes?: NomesConhecidos
}): DetalheMontado {
  const { passos, desfecho, esperasEncerradas, nomes = {} } = args
  const executados = Array.isArray(args.executados) ? args.executados.filter(Boolean) : []
  const porId = new Map(passos.map((p) => [p.id, p]))
  const indiceDaParada = desfecho === 'falhou' ? falhaQueParou(executados) : -1

  const lista: PassoDoDetalhe[] = []
  executados.forEach((e, i) => {
    if (e.status === 'skipped' && e.detail && ANOTACOES.has(e.detail)) return
    // O passo pode ter sido editado ou apagado depois de rodar: o registro é a
    // fotografia, e o rótulo cai para o tipo, sem config, em vez de sumir.
    const passo = porId.get(e.step_id) ?? { step_type: e.step_type }
    const resumo = descreverPasso(passo, nomes)
    lista.push({
      id: `${e.step_id || 'motor'}-${i}`,
      estado:
        e.status === 'failed' && ehAvisoDeTentativa(e.detail)
          ? 'tentativa'
          : (ESTADO_POR_STATUS[e.status as keyof typeof ESTADO_POR_STATUS] ?? 'feito'),
      tipo: e.step_type,
      chave: resumo.chave,
      valores: resumo.valores,
      alvoSumiu: resumo.alvoSumiu,
      ...(e.detail ? { detalhe: e.detail } : {}),
      ...(i === indiceDaParada ? { parou: true as const } : {}),
      ...(e.step_id ? {} : { doMotor: true as const }),
    })
  })

  if (desfecho !== 'falhou' && desfecho !== 'interrompida') {
    return { passos: lista, naoRodaram: null }
  }

  const rodaram = idsQueRodaram(executados)
  const depoisDaParada: PassoDaAutomacao[][] = []

  // (a) Falha num passo de verdade: o que vinha depois dele.
  const parada = indiceDaParada >= 0 ? executados[indiceDaParada] : undefined
  if (parada?.step_id) {
    const passo = porId.get(parada.step_id)
    if (!passo) return { passos: lista, naoRodaram: null, naoRodaramDesconhecido: true }
    depoisDaParada.push(
      daquiEmDiante(passos, porId, {
        parent: passo.parent_step_id ?? null,
        branch: passo.branch ?? null,
        desde: passo.position + 1,
      }),
    )
  } else {
    // (b) Interrompida, ou falha AO ACORDAR (conferência de etapa, passo que
    // sumiu — o registro diz `step_id: ''`): o ponto de parada é a espera da
    // fila. A mesma régua da retomada (`decidirRetomada`), nunca a posição
    // crua: depois de uma edição ela aponta para outro passo.
    for (const espera of esperasEncerradas) {
      const gravado = lerPassoDaFila(espera.context)
      const agora = gravado ? porId.get(gravado.id) : undefined
      const retomada = decidirRetomada(
        { ...espera, context: null },
        gravado,
        agora
          ? { parent_step_id: agora.parent_step_id, branch: agora.branch, position: agora.position }
          : null,
      )
      if (retomada.tipo === 'parar') {
        return { passos: lista, naoRodaram: null, naoRodaramDesconhecido: true }
      }
      depoisDaParada.push(
        daquiEmDiante(passos, porId, {
          parent: espera.parent_step_id ?? null,
          branch: espera.branch ?? null,
          desde: retomada.posicao,
        }),
      )
    }
    // (c) Interrompida enquanto RODAVA, sem espera na fila: o motor grava o
    // passo que deixou de rodar como "não executado" (`skipped`).
    if (depoisDaParada.length === 0) {
      const naoExecutado = executados.find(
        (e) =>
          e.status === 'skipped' &&
          e.step_type !== 'condition' &&
          porId.has(e.step_id) &&
          !ANOTACOES.has(e.detail ?? ''),
      )
      const passo = naoExecutado ? porId.get(naoExecutado.step_id) : undefined
      if (passo) {
        depoisDaParada.push(
          daquiEmDiante(passos, porId, {
            parent: passo.parent_step_id ?? null,
            branch: passo.branch ?? null,
            desde: passo.position,
          }),
        )
      }
    }
    if (depoisDaParada.length === 0) return { passos: lista, naoRodaram: null }
  }

  const vistos = new Set<string>()
  const naoRodaram: PassoQueNaoRodou[] = []
  for (const p of depoisDaParada.flat()) {
    if (vistos.has(p.id) || rodaram.has(p.id)) continue
    vistos.add(p.id)
    naoRodaram.push(paraNaoRodou(p, nomes))
  }
  return { passos: lista, naoRodaram }
}
