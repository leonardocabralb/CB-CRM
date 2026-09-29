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
// ⚠️⚠️ A ORDEM GRAVADA NÃO É A ORDEM EM QUE RODOU quando há ramo cheio: o ramo
// de uma condição grava o array DELE ao terminar (ou ao estacionar), ANTES de
// o escopo de fora gravar o seu — que contém os passos anteriores e a própria
// condição (`engine.ts`, "Nested branch — just append results"). `[A, C, D]`
// com o ramo `[B]` sai gravado `[B, A, C, D]`. `emOrdem` põe de volta: o
// trecho do ramo gravado ANTES da condição vai para logo depois dela; o
// gravado DEPOIS (a retomada de uma espera do ramo) fica onde está — ele
// rodou depois de tudo o que foi gravado antes dele.
//
// ⚠️ "Não rodaram" é a lista dos passos do plano que ficaram DEPOIS do ponto
// de parada e que NÃO aparecem como executados no registro desta execução.
// Os dois recortes são necessários:
//   - "depois do ponto" sobe do escopo do passo até a raiz: passo que falha
//     dentro de um ramo encerra a execução inteira (`automacoes.md`), então o
//     que vinha depois da condição também não rodou;
//   - "não aparece no registro" porque um "Aguardar" dentro de ramo NÃO segura
//     o escopo de fora — os passos depois da condição podem já ter rodado
//     antes de a espera do ramo acordar e falhar. Listá-los seria mentira.
//     Aviso de retentativa NÃO conta como executado: o envio que foi recusado
//     e reagendado, e depois cancelado, não saiu.
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
import { falhaQueEncerrou, MOTIVOS_DA_RETOMADA, type DesfechoDoHistorico } from './desfecho'
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
  /** Chave de render (`step_id` + índice gravado: o mesmo passo roda mais de uma vez na retentativa). */
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
   * Linha do MOTOR, não de um passo: a conferência ao acordar ou ao nascer
   * que parou a execução (`step_id` vazio, ou o motivo da retomada). O tipo
   * gravado (`wait`) não descreve nada — a tela usa um rótulo próprio.
   */
  doMotor?: true
  /**
   * O passo rodou, mas saiu da automação depois (editada): o rótulo é o do
   * TIPO — sem a config, `descreverPasso` diria "Aguardar 0 h" ou "(apagado)"
   * sobre uma etiqueta que existe.
   */
  removido?: true
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
 * Textos das anotações de interrupção (`interrupcao.ts`, e a guarda por passo
 * do motor): a tela diz o motivo no rodapé, a partir de `interrompida_por`;
 * repetir a anotação como "passo" pularia um "Aguardar" que não foi pulado.
 */
const ANOTACOES = new Set<string>([DETALHE_DA_INTERRUPCAO, DETALHE_SAIU_DA_ETAPA])

/**
 * Linha do MOTOR: sem passo (conferência ao acordar ou ao nascer), ou um dos
 * motivos com que a RETOMADA para (`MOTIVOS_DA_RETOMADA`) — gravados com o id
 * do passo que estacionou e tipo `wait`. O ponto de parada delas é a espera
 * da fila, nunca o escopo onde o passo está hoje (movido, está noutro ramo).
 */
const doMotor = (e: PassoExecutado) => !e.step_id || MOTIVOS_DA_RETOMADA.has(e.detail ?? '')

/**
 * O que o registro diz que RODOU. `skipped` só conta na condição (ela avaliou e
 * desviou); nos outros é "não executado: …", "não estacionada: …" ou a
 * anotação — o passo NÃO rodou. O aviso de retentativa também não conta: o
 * envio foi recusado e reagendado (se a tentativa seguinte saiu, ela tem a
 * própria entrada `success`).
 */
function idsQueRodaram(executados: readonly PassoExecutado[]): Set<string> {
  const ids = new Set<string>()
  for (const e of executados) {
    if (!e?.step_id || doMotor(e)) continue
    if (e.status === 'skipped' && e.step_type !== 'condition') continue
    if (e.status === 'failed' && ehAvisoDeTentativa(e.detail)) continue
    ids.add(e.step_id)
  }
  return ids
}

/**
 * A ordem em que rodou (ver o cabeçalho): cada entrada de ramo gravada ANTES
 * da sua condição vai para logo depois dela, recursivamente (ramo dentro de
 * ramo). O resto fica na ordem gravada — inclusive o que não se acha no plano
 * de hoje, que não tem como ser realocado.
 */
function emOrdem<T>(
  itens: readonly T[],
  executados: readonly PassoExecutado[],
  porId: ReadonlyMap<string, PassoDaAutomacao>,
): T[] {
  // Onde cada condição foi gravada (a primeira vez: uma execução avalia a
  // mesma condição uma vez só).
  const indiceDaCondicao = new Map<string, number>()
  executados.forEach((e, i) => {
    if (e.step_type === 'condition' && e.step_id && !indiceDaCondicao.has(e.step_id)) {
      indiceDaCondicao.set(e.step_id, i)
    }
  })
  const depoisDe = new Map<string, number[]>()
  const base: number[] = []
  executados.forEach((e, i) => {
    const pai = e.step_id ? porId.get(e.step_id)?.parent_step_id : undefined
    const j = pai ? indiceDaCondicao.get(pai) : undefined
    if (pai && j !== undefined && j > i) {
      const lista = depoisDe.get(pai) ?? []
      lista.push(i)
      depoisDe.set(pai, lista)
    } else {
      base.push(i)
    }
  })
  const saida: T[] = []
  const emitir = (indices: readonly number[]) => {
    for (const i of indices) {
      saida.push(itens[i])
      const e = executados[i]
      const filhos = e.step_type === 'condition' ? depoisDe.get(e.step_id) : undefined
      if (filhos) {
        // Apaga ANTES de descer: um ciclo em `parent_step_id` (dado
        // corrompido) não pode recursar para sempre.
        depoisDe.delete(e.step_id)
        emitir(filhos)
      }
    }
  }
  emitir(base)
  return saida
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

const doEscopo = (p: PassoDaAutomacao, parent: string | null, branch: 'yes' | 'no' | null) =>
  (p.parent_step_id ?? null) === parent && (p.branch ?? null) === branch

interface Escopo {
  parent: string | null
  branch: 'yes' | 'no' | null
  /** A partir de qual posição (inclusive) o escopo conta. */
  desde: number
}

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

/** A partir do próprio passo (inclusive), no escopo dele e subindo. */
const aPartirDo = (
  passos: readonly PassoDaAutomacao[],
  porId: ReadonlyMap<string, PassoDaAutomacao>,
  passo: PassoDaAutomacao,
  inclusive: boolean,
) =>
  daquiEmDiante(passos, porId, {
    parent: passo.parent_step_id ?? null,
    branch: passo.branch ?? null,
    desde: inclusive ? passo.position : passo.position + 1,
  })

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
  const indiceDaParada = desfecho === 'falhou' ? falhaQueEncerrou(executados) : -1

  // Um item por entrada gravada (o índice acompanha: é a chave de render); as
  // anotações de interrupção ficam de fora DEPOIS da reordenação.
  const itens: (PassoDoDetalhe | null)[] = executados.map((e, i) => {
    if (e.status === 'skipped' && e.detail && ANOTACOES.has(e.detail)) return null
    const passo = porId.get(e.step_id)
    const motor = doMotor(e)
    // O passo pode ter sido editado ou apagado depois de rodar: o registro é a
    // fotografia; sem o passo, o rótulo é o do TIPO (`removido`).
    const resumo = descreverPasso(passo ?? { step_type: e.step_type }, nomes)
    return {
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
      ...(motor ? { doMotor: true as const } : {}),
      ...(!motor && !passo ? { removido: true as const } : {}),
    }
  })
  const lista = emOrdem(itens, executados, porId).filter((p): p is PassoDoDetalhe => p !== null)

  if (desfecho !== 'falhou' && desfecho !== 'interrompida') {
    return { passos: lista, naoRodaram: null }
  }

  const rodaram = idsQueRodaram(executados)
  const depoisDaParada: PassoDaAutomacao[][] = []

  const parada = indiceDaParada >= 0 ? executados[indiceDaParada] : undefined
  if (parada && !doMotor(parada)) {
    // (a) Falha num passo de verdade: o que vinha depois dele.
    const passo = porId.get(parada.step_id)
    if (!passo) return { passos: lista, naoRodaram: null, naoRodaramDesconhecido: true }
    depoisDaParada.push(aPartirDo(passos, porId, passo, false))
  } else {
    // (b) Interrompida, ou falha AO ACORDAR (conferência de etapa, passo que
    // sumiu): o ponto de parada é a espera da fila. A mesma régua da
    // retomada (`decidirRetomada`), nunca a posição crua: depois de uma
    // edição ela aponta para outro passo.
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
    // (c) E o passo que deixou de rodar no MEIO de um escopo (sem espera na
    // fila): o motor o grava `skipped` — "não executado", "card saiu da
    // etapa", "não estacionada". Soma com (b): um escopo pode ter parado
    // assim enquanto outro estava estacionado. A anotação da interrupção
    // aponta a espera que já rodou; o recorte do que rodou a descarta.
    for (const e of executados) {
      if (e.status !== 'skipped' || e.step_type === 'condition' || doMotor(e)) continue
      const passo = porId.get(e.step_id)
      if (passo) depoisDaParada.push(aPartirDo(passos, porId, passo, true))
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
