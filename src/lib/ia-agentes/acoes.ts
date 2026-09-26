// ============================================================
// As AÇÕES que o agente devolve JUNTO com a resposta (F4, D28 do
// docs/PLANO-agentes-de-ia.md). PURO, testado.
//
// Não há laço de ferramentas: o modelo escreve a resposta ao cliente e, no
// fim, marcadores no mesmo protocolo do `[[PASSAR:n]]` da F2 —
// `[[MOVER:n]]`, `[[ETIQUETAR:n]]`, `[[TIRAR:n]]`, `[[CAMPO:n=valor]]`,
// `[[TAREFA:n=título]]`, `[[AUTOMACAO:n]]`. O `n` é o número de uma opção
// que o SERVIDOR listou no pedido (`OpcoesDeAcao`, com os nomes); o servidor
// traduz o número para o id. Número fora da lista = recusada.
//
// ⚠️⚠️ O marcador NUNCA chega ao cliente: `lerAcoes` tira do texto TODO
// `[[…]]`, inclusive o malformado e o que ficou aberto no fim (resposta
// cortada pelo teto de tokens).
//
// Também aqui (puros):
//  - a trava de LINK INVENTADO: toda URL da resposta tem de ter aparecido,
//    como URL, no que foi mandado ao modelo (o pedido montado e as mensagens
//    da conversa) — modelo inventa link de boleto;
//  - a régua da D5 sobre os passos de uma automação (`motivoForaDaD5`),
//    atravessando as automações que ela aciona, com trava de ciclo;
//  - os campos de DATA vigiados por lembrete (`camposVigiados`);
//  - o parse do registro das ações do turno (`cb_ia_turnos.acoes`).
// ============================================================

import { TIPOS_DE_ACAO, type TipoDeAcao } from './agente'

/** Uma opção que o servidor oferece ao modelo, numerada a partir de 1 na ordem da lista. */
export interface OpcaoDeAcao {
  id: string
  nome: string
}

/** As opções de cada tipo liberado NAQUELE agente. Tipo ausente ou vazio = não oferecido. */
export type OpcoesDeAcao = Partial<Record<TipoDeAcao, OpcaoDeAcao[]>>

/** O marcador de cada tipo, como o modelo o escreve. */
export const MARCADOR_DA_ACAO: Record<TipoDeAcao, string> = {
  mover_etapa: 'MOVER',
  etiquetar: 'ETIQUETAR',
  tirar_etiqueta: 'TIRAR',
  preencher_campo: 'CAMPO',
  criar_tarefa: 'TAREFA',
  executar_automacao: 'AUTOMACAO',
}

/** Os tipos que levam `=valor` (o valor do campo, o título da tarefa). */
export const ACOES_COM_VALOR: ReadonlySet<TipoDeAcao> = new Set(['preencher_campo', 'criar_tarefa'])

export const LIMITES_DAS_ACOES = {
  /** Ações por resposta; o que passar é recusado (`teto`). */
  porResposta: 10,
  /** Valor de campo, depois de aparado. */
  valorDoCampo: 500,
  /** Título da tarefa (o mesmo teto de `cb_tasks`). */
  tituloDaTarefa: 200,
} as const

/** Por que uma ação pedida não vai executar. A tela traduz o código. */
export type MotivoDaRecusa =
  /** O marcador não tem a forma (número ilegível, valor vazio ou longo demais). */
  | 'malformada'
  /** Passou de `LIMITES_DAS_ACOES.porResposta`. */
  | 'teto'
  /** O tipo não está liberado neste agente (ou não tem item). */
  | 'nao_liberada'
  /** O número não é de nenhuma opção listada. */
  | 'fora_da_lista'
  /** A resposta foi uma passagem (D25): as ações não executam. */
  | 'passagem'
  /** A resposta transfere para gente: as ações não executam. */
  | 'transferencia'

export interface AcaoPedida {
  tipo: TipoDeAcao
  n: number
  /** O valor do campo ou o título da tarefa, aparado e numa linha. */
  valor?: string
}

export interface RecusaDeAcao {
  tipo: TipoDeAcao
  /** O número pedido (nulo quando nem ele se leu). */
  n: number | null
  motivo: MotivoDaRecusa
}

export interface LeituraDasAcoes {
  /** A resposta ao cliente, SEM nenhum marcador. */
  texto: string
  pedidas: AcaoPedida[]
  /** As que já se recusam na leitura (forma, teto). */
  recusadas: RecusaDeAcao[]
}

const TIPO_DO_MARCADOR = new Map<string, TipoDeAcao>(
  TIPOS_DE_ACAO.map((t) => [MARCADOR_DA_ACAO[t], t]),
)

/** Qualquer `[[…]]`, fechado — pode atravessar linhas. */
const MARCADOR = /\[\[([\s\S]*?)\]\]/g
/** `[[` que ficou aberto até o fim (a resposta cortada no meio de um marcador). */
const MARCADOR_ABERTO = /\[\[(?![\s\S]*\]\])[\s\S]*$/
/** O miolo de um marcador de ação: `TIPO : n` e, opcional, `= valor`. */
const MIOLO = /^\s*([A-Za-z]+)\s*:\s*([^=]*?)\s*(?:=([\s\S]*))?$/

function numaLinha(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim()
}

/**
 * Lê os marcadores de ação da resposta do modelo e devolve o texto LIMPO.
 * Tolera espaço e caixa, como `lerPassagem`. Tira do texto todo `[[…]]` — o
 * de ação, o `[[PASSAR:n]]`, o sentinela e o que não se reconhece — e o `[[`
 * aberto no fim. Marcador de ação com forma errada vira recusada
 * (`malformada`); passado o teto de ações, `teto`.
 */
export function lerAcoes(texto: string): LeituraDasAcoes {
  const pedidas: AcaoPedida[] = []
  const recusadas: RecusaDeAcao[] = []

  for (const m of texto.matchAll(MARCADOR)) {
    const miolo = MIOLO.exec(m[1])
    if (!miolo) continue
    const tipo = TIPO_DO_MARCADOR.get(miolo[1].toUpperCase())
    // PASSAR, HANDOFF e o que não é ação: só saem do texto.
    if (!tipo) continue
    const n = /^\d+$/.test(miolo[2]) ? Number.parseInt(miolo[2], 10) : Number.NaN
    if (!Number.isSafeInteger(n) || n < 1) {
      recusadas.push({ tipo, n: null, motivo: 'malformada' })
      continue
    }
    let valor: string | undefined
    if (ACOES_COM_VALOR.has(tipo)) {
      valor = numaLinha(miolo[3] ?? '')
      const teto = tipo === 'preencher_campo' ? LIMITES_DAS_ACOES.valorDoCampo : LIMITES_DAS_ACOES.tituloDaTarefa
      if (!valor || valor.length > teto) {
        recusadas.push({ tipo, n, motivo: 'malformada' })
        continue
      }
    }
    if (pedidas.length >= LIMITES_DAS_ACOES.porResposta) {
      recusadas.push({ tipo, n, motivo: 'teto' })
      continue
    }
    pedidas.push(valor === undefined ? { tipo, n } : { tipo, n, valor })
  }

  // O marcador sai com os espaços em volta ("Ok [[MOVER:1]] feito" → "Ok feito").
  const limpo = texto
    .replace(/[ \t]*\[\[[\s\S]*?\]\][ \t]*/g, ' ')
    .replace(MARCADOR_ABERTO, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { texto: limpo, pedidas, recusadas }
}

/** Uma ação com os IDS do servidor, pronta para executar. */
export interface AcaoResolvida {
  tipo: TipoDeAcao
  id: string
  nome: string
  valor?: string
}

/**
 * Número → id, pelas opções que o SERVIDOR listou no pedido. Tipo não
 * liberado ou número fora da lista = recusada. Repetidas colapsam: a mesma
 * etapa, etiqueta ou automação uma vez só; o mesmo campo fica com o ÚLTIMO
 * valor pedido; tarefa repetida só com o mesmo título (títulos diferentes
 * para a mesma pessoa são tarefas diferentes).
 */
export function resolverAcoes(
  pedidas: readonly AcaoPedida[],
  opcoes: OpcoesDeAcao,
): { aceitas: AcaoResolvida[]; recusadas: RecusaDeAcao[] } {
  const aceitas: AcaoResolvida[] = []
  const recusadas: RecusaDeAcao[] = []
  const indiceDe = new Map<string, number>()
  for (const p of pedidas) {
    const lista = opcoes[p.tipo] ?? []
    if (lista.length === 0) {
      recusadas.push({ tipo: p.tipo, n: p.n, motivo: 'nao_liberada' })
      continue
    }
    const opcao = lista[p.n - 1]
    if (!opcao) {
      recusadas.push({ tipo: p.tipo, n: p.n, motivo: 'fora_da_lista' })
      continue
    }
    const chave = p.tipo === 'criar_tarefa' ? `${p.tipo}|${opcao.id}|${p.valor}` : `${p.tipo}|${opcao.id}`
    const ja = indiceDe.get(chave)
    if (ja !== undefined) {
      if (p.tipo === 'preencher_campo') aceitas[ja] = { ...aceitas[ja], valor: p.valor }
      continue
    }
    indiceDe.set(chave, aceitas.length)
    aceitas.push(p.valor === undefined ? { tipo: p.tipo, id: opcao.id, nome: opcao.nome } : {
      tipo: p.tipo,
      id: opcao.id,
      nome: opcao.nome,
      valor: p.valor,
    })
  }
  return { aceitas, recusadas }
}

/** Quantas opções há, somando os tipos (zero = o pedido não fala de ações). */
export function totalDeOpcoes(opcoes: OpcoesDeAcao): number {
  return TIPOS_DE_ACAO.reduce((n, t) => n + (opcoes[t]?.length ?? 0), 0)
}

// ------------------------------------------------------------
// A trava de link inventado (5.6)
// ------------------------------------------------------------

const URL_NO_TEXTO = /\bhttps?:\/\/[^\s<>"'`]+/gi
/** Pontuação que encosta na URL sem ser dela (fim de frase, negrito/itálico do WhatsApp). */
const PONTUACAO_FINAL = /[.,;:!?)\]}*_~]+$/

/** As URLs http(s) do texto, sem a pontuação que encosta no fim. */
export function urlsDoTexto(texto: string): string[] {
  return [...texto.matchAll(URL_NO_TEXTO)].map((m) => m[0].replace(PONTUACAO_FINAL, '')).filter((u) => u.length > 0)
}

/**
 * A resposta traz um link que NÃO veio do que foi mandado ao modelo?
 * `fontes` = o pedido montado (instruções, regras, blocos de acesso, trechos
 * da base) e as mensagens da conversa. A comparação é por URL INTEIRA, não
 * por pedaço de texto: um link cortado ("…/i/12" de "…/i/123") também é
 * inventado — ele levaria o cliente a outro lugar.
 */
export function linkInventado(texto: string, fontes: readonly string[]): boolean {
  const urls = urlsDoTexto(texto)
  if (urls.length === 0) return false
  const conhecidas = new Set(fontes.flatMap(urlsDoTexto))
  return urls.some((u) => !conhecidas.has(u))
}

// ------------------------------------------------------------
// A D5 nos passos de uma automação
// ------------------------------------------------------------

/** O passo que tira a automação da D5 (o código vai para a tela). */
export type MotivoForaDaD5 =
  | 'send_to_number'
  | 'send_webhook'
  | 'status_de_resultado'
  | 'etapa_de_resultado'
  | 'run_flow'
  | 'campo_vigiado'

/** O que a régua da D5 precisa saber da conta, além dos passos. */
export interface ReguaDaD5 {
  /** Etapas com `pipeline_stages.resultado` (ganho/perdido). */
  etapasDeResultado: ReadonlySet<string>
  /** Campos de data vigiados por lembrete ligado (`camposVigiados`). */
  camposVigiados: ReadonlySet<string>
}

export interface PassoDaAutomacao {
  tipo: string
  config: Record<string, unknown>
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * O passo sai da D5? Mensagem para outro número, webhook de saída, ganho ou
 * perdido (pelo status ou por etapa com resultado — mover para ela ou criar
 * o card nela), iniciar robô (o `run_flow` não carrega origem nem contexto,
 * e a cascata do robô sairia da D5) e preencher campo de data vigiado por
 * lembrete (o cron dispararia aquela automação depois — 5.6, Codex #292).
 */
export function motivoDoPasso(p: PassoDaAutomacao, regua: ReguaDaD5): MotivoForaDaD5 | null {
  switch (p.tipo) {
    case 'send_to_number':
      return 'send_to_number'
    case 'send_webhook':
      return 'send_webhook'
    case 'run_flow':
      return 'run_flow'
    case 'set_deal_status':
      return p.config.status === 'won' || p.config.status === 'lost' ? 'status_de_resultado' : null
    case 'move_deal_stage':
    case 'create_deal': {
      const etapa = texto(p.config.stage_id)
      return etapa && regua.etapasDeResultado.has(etapa) ? 'etapa_de_resultado' : null
    }
    case 'update_contact_field': {
      const campo = texto(p.config.field)
      return campo?.startsWith('custom:') && regua.camposVigiados.has(campo.slice('custom:'.length))
        ? 'campo_vigiado'
        : null
    }
    default:
      return null
  }
}

/** As automações que os passos acionam (`run_automation`). */
export function automacoesAcionadas(passos: readonly PassoDaAutomacao[]): string[] {
  return passos
    .filter((p) => p.tipo === 'run_automation')
    .map((p) => texto(p.config.automation_id))
    .filter((id): id is string => id !== null)
}

/** As etapas que os passos citam (para saber quais têm resultado). */
export function etapasCitadas(passos: readonly PassoDaAutomacao[]): string[] {
  return passos
    .filter((p) => p.tipo === 'move_deal_stage' || p.tipo === 'create_deal')
    .map((p) => texto(p.config.stage_id))
    .filter((id): id is string => id !== null)
}

/**
 * O primeiro passo fora da D5 da automação `raiz` ou das que ela aciona
 * (em profundidade, com TRAVA DE CICLO: A aciona B, B aciona A). Automação
 * que não está no mapa (de outra conta, apagada) não é percorrida: o motor a
 * recusaria na hora de acionar.
 */
export function motivoForaDaD5(
  raiz: string,
  passosDe: ReadonlyMap<string, readonly PassoDaAutomacao[]>,
  regua: ReguaDaD5,
): MotivoForaDaD5 | null {
  const vistas = new Set<string>()
  const pilha = [raiz]
  while (pilha.length > 0) {
    const id = pilha.pop() as string
    if (vistas.has(id)) continue
    vistas.add(id)
    const passos = passosDe.get(id)
    if (!passos) continue
    for (const p of passos) {
      const motivo = motivoDoPasso(p, regua)
      if (motivo) return motivo
    }
    pilha.push(...automacoesAcionadas(passos))
  }
  return null
}

// ------------------------------------------------------------
// Campo de data vigiado por lembrete
// ------------------------------------------------------------

/**
 * Os campos que uma automação de lembrete LIGADA (`date_field_offset` com
 * fonte "campo") vigia. Preencher um deles faria o cron disparar aquela
 * automação depois, fora da D5 (5.6, Codex #292): a IA não o preenche.
 */
export function camposVigiados(
  automacoes: ReadonlyArray<{ trigger_type: string; trigger_config: unknown; is_active: boolean }>,
): Set<string> {
  const vigiados = new Set<string>()
  for (const a of automacoes) {
    if (!a.is_active || a.trigger_type !== 'date_field_offset') continue
    const cfg =
      a.trigger_config && typeof a.trigger_config === 'object' ? (a.trigger_config as Record<string, unknown>) : {}
    if (cfg.fonte !== undefined && cfg.fonte !== null && cfg.fonte !== 'campo') continue
    const campo = texto(cfg.custom_field_id)
    if (campo) vigiados.add(campo)
  }
  return vigiados
}

// ------------------------------------------------------------
// O registro das ações do turno (`cb_ia_turnos.acoes`)
// ------------------------------------------------------------

/** Uma linha de `cb_ia_turnos.acoes`: o que a ação fez (ou por que não). */
export interface RegistroDeAcao {
  tipo: string
  alvo: { id: string | null; nome: string }
  ok: boolean
  /** Código (`fora_da_lista`, `etapa_de_resultado`…) ou o motivo do motor. */
  erro?: string
}

/** A recusa como linha do registro (o alvo é o número pedido). */
export function registroDaRecusa(r: RecusaDeAcao): RegistroDeAcao {
  return { tipo: r.tipo, alvo: { id: null, nome: r.n === null ? '' : `#${r.n}` }, ok: false, erro: r.motivo }
}

/** O registro guardado → a forma da rota. Parse, nunca `as`: nulo quando não é lista. */
export function lerRegistrosDasAcoes(v: unknown): RegistroDeAcao[] | null {
  if (!Array.isArray(v)) return null
  const saida: RegistroDeAcao[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const alvo = r.alvo && typeof r.alvo === 'object' ? (r.alvo as Record<string, unknown>) : {}
    if (typeof r.tipo !== 'string' || typeof r.ok !== 'boolean') continue
    saida.push({
      tipo: r.tipo,
      alvo: {
        id: typeof alvo.id === 'string' ? alvo.id : null,
        nome: typeof alvo.nome === 'string' ? alvo.nome : '',
      },
      ok: r.ok,
      ...(typeof r.erro === 'string' ? { erro: r.erro } : {}),
    })
  }
  return saida
}
