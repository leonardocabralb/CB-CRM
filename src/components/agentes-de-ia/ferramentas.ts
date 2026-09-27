// ============================================================
// As ferramentas de um agente de IA (F4, D28) do lado da TELA: a leitura
// das opções que a sub-aba Ferramentas oferece, as listas de cada tipo de
// ação e a leitura das ações que o Playground e a sub-aba Turnos mostram.
// PURO, testado.
//
// ⚠️ Tudo aqui é PARSE, nunca `as`: a forma vem da rota (e o jsonb do turno,
// de qualquer versão do servidor). Resposta estranha vira "não se sabe" —
// `null` nas opções (a tela diz que falhou) e nas ações (nada é mostrado),
// nunca lista vazia, que seria a lista vazia virando afirmação.
// ============================================================

import type {
  AcaoDoTurno,
  AcoesSimuladas,
  HorarioOferecido,
  OpcoesDasFerramentas,
  TipoDeAcao,
  TipoDeEventoDoCalendly,
} from './tipos'

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** Um código de motivo (da D5): só texto não vazio; o resto não inventa bloqueio. */
function codigo(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null
}

/** Os itens de uma lista que têm a forma pedida; lista ausente = a resposta não serve. */
function linhas<T>(v: unknown, ler: (o: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(v)) return null
  const saida: T[] = []
  for (const item of v) {
    const o = objeto(item)
    const lido = o ? ler(o) : null
    if (lido) saida.push(lido)
  }
  return saida
}

/** A resposta de `GET …/ferramentas/opcoes`; forma estranha = `null` (a carga falhou). */
export function lerOpcoes(v: unknown): OpcoesDasFerramentas | null {
  const o = objeto(v)
  if (!o) return null
  const etapas = linhas<OpcoesDasFerramentas['etapas'][number]>(o.etapas, (e) => {
    const id = texto(e.id)
    const nome = texto(e.nome)
    const funil = texto(e.funil)
    if (!id || nome === null || funil === null) return null
    const resultado = e.resultado === 'ganho' || e.resultado === 'perdido' ? e.resultado : null
    return { id, nome, funil, resultado }
  })
  const etiquetas = linhas<OpcoesDasFerramentas['etiquetas'][number]>(o.etiquetas, (e) => {
    const id = texto(e.id)
    const nome = texto(e.nome)
    return id && nome !== null ? { id, nome } : null
  })
  const campos = linhas<OpcoesDasFerramentas['campos'][number]>(o.campos, (c) => {
    const id = texto(c.id)
    const nome = texto(c.nome)
    if (!id || nome === null) return null
    const opcoes = Array.isArray(c.opcoes) ? c.opcoes.filter((x): x is string => typeof x === 'string') : []
    // Só o booleano `true` bloqueia; qualquer outra coisa não inventa bloqueio.
    return { id, nome, vigiado: c.vigiado === true, tipo: codigo(c.tipo), opcoes }
  })
  const membros = linhas(o.membros, (m) => {
    const userId = texto(m.userId)
    const nome = texto(m.nome)
    return userId && nome !== null ? { userId, nome } : null
  })
  const automacoes = linhas(o.automacoes, (a) => {
    const id = texto(a.id)
    const nome = texto(a.nome)
    if (!id || nome === null) return null
    return { id, nome, foraDaD5: codigo(a.foraDaD5) }
  })
  if (!etapas || !etiquetas || !campos || !membros || !automacoes) return null
  return { etapas, etiquetas, campos, membros, automacoes, ...lerCalendly(o) }
}

/**
 * O Calendly das opções (F5). ⚠️ Estado fora dos três (resposta de um
 * servidor anterior à F5, forma estranha) vira `falhou` — nunca
 * `desconectado`, que mandaria o administrador reconectar o que pode estar
 * de pé. `conectado` sem a lista legível também vira `falhou`: lista vazia
 * aqui seria "o Calendly não tem tipos de evento", uma afirmação sobre dado
 * que não chegou.
 */
function lerCalendly(o: Record<string, unknown>): Pick<OpcoesDasFerramentas, 'calendly' | 'tiposDeEvento'> {
  if (o.calendly === 'desconectado') return { calendly: 'desconectado', tiposDeEvento: null }
  if (o.calendly !== 'conectado') return { calendly: 'falhou', tiposDeEvento: null }
  const tipos = linhas<TipoDeEventoDoCalendly>(o.tiposDeEvento, (e) => {
    const uri = texto(e.uri)
    const nome = texto(e.nome)
    if (!uri || nome === null) return null
    // Duração ilegível = 0: a tela omite o "· N min", nunca inventa um número.
    const duracao = typeof e.duracao === 'number' && Number.isFinite(e.duracao) && e.duracao > 0 ? e.duracao : 0
    return { uri, nome, duracao }
  })
  return tipos ? { calendly: 'conectado', tiposDeEvento: tipos } : { calendly: 'falhou', tiposDeEvento: null }
}

/**
 * O que a seção "Marcar reunião" da sub-aba Ferramentas mostra (F5), pelas
 * opções e pelo que está marcado — UM tipo de evento, escolhido num select:
 *  - `desconectado`: não há Calendly conectado (o motivo e o link para
 *    Integrações; ligado assim, o Salvar é recusado);
 *  - `falhou`: a leitura dos tipos não respondeu ("não consegui ler" e
 *    tentar de novo) — nunca "não há tipos";
 *  - `sem_tipos`: o Calendly respondeu, sem tipo de evento ativo;
 *  - `escolher`: o select. `orfao` = o tipo marcado não está mais entre os
 *    ativos (desativado ou apagado no Calendly): o select fica sem escolha e
 *    a tela diz por quê — o Salvar o descarta (`ferramentasParaSalvar`).
 */
export type SituacaoDaReuniao =
  | { fase: 'desconectado' }
  | { fase: 'falhou' }
  | { fase: 'sem_tipos' }
  | { fase: 'escolher'; tipos: TipoDeEventoDoCalendly[]; escolhido: string | null; orfao: boolean }

export function situacaoDaReuniao(opcoes: OpcoesDasFerramentas, marcados: readonly string[]): SituacaoDaReuniao {
  if (opcoes.calendly === 'desconectado') return { fase: 'desconectado' }
  if (opcoes.calendly !== 'conectado' || opcoes.tiposDeEvento === null) return { fase: 'falhou' }
  const tipos = opcoes.tiposDeEvento
  if (tipos.length === 0) return { fase: 'sem_tipos' }
  const ativos = new Set(tipos.map((e) => e.uri))
  const escolhido = marcados.find((uri) => ativos.has(uri)) ?? null
  return { fase: 'escolher', tipos, escolhido, orfao: escolhido === null && marcados.length > 0 }
}

/**
 * Os horários livres que o Playground ofereceu ao modelo (F5,
 * `horarios` da rota). `null` = o tipo está desligado, a leitura falhou ou o
 * cliente já tem reunião (nada é mostrado); lista (vazia inclusive) = o que
 * foi oferecido. Item
 * estranho sai, sem quebrar a lista.
 */
export function lerHorariosOferecidos(v: unknown): HorarioOferecido[] | null {
  return linhas<HorarioOferecido>(v, (h) => {
    const n = h.n
    const t = texto(h.texto)
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || t === null || !t.trim()) return null
    return { n, texto: t }
  })
}

/** Acima disto a lista de horários do Playground aparece recolhida (F5). */
export const HORARIOS_A_MOSTRA = 4

/**
 * Por que um item NÃO pode ser marcado (a D5, calculada pelo servidor):
 * etapa de ganho/perdido, campo de data vigiado por lembrete e automação com
 * passo fora da D5 (o código do passo). As automações que a etapa ou a
 * etiqueta disparam não contam (a D5 vale só para o que o agente faz,
 * 27/09/2026).
 */
export type Bloqueio =
  | { tipo: 'etapa_de_resultado' }
  | { tipo: 'campo_vigiado' }
  | { tipo: 'fora_da_d5'; codigo: string }

export interface ItemDaLista {
  id: string
  nome: string
  /** O funil da etapa (as etapas aparecem agrupadas); nulo nas outras listas. */
  grupo: string | null
  bloqueio: Bloqueio | null
  /** Só nos campos: o tipo (`field_type`) e as opções da lista, que a tela mostra ao lado do nome. */
  campo?: { tipo: string | null; opcoes: string[] }
}

/** A lista de um tipo de ação, na ordem em que o servidor a mandou. */
export function itensDoTipo(opcoes: OpcoesDasFerramentas, tipo: TipoDeAcao): ItemDaLista[] {
  switch (tipo) {
    case 'mover_etapa':
      return opcoes.etapas.map((e) => ({
        id: e.id,
        nome: e.nome,
        grupo: e.funil,
        bloqueio: e.resultado ? { tipo: 'etapa_de_resultado' } : null,
      }))
    case 'etiquetar':
    case 'tirar_etiqueta':
      return opcoes.etiquetas.map((e) => ({ id: e.id, nome: e.nome, grupo: null, bloqueio: null }))
    case 'preencher_campo':
      return opcoes.campos.map((c) => ({
        id: c.id,
        nome: c.nome,
        grupo: null,
        bloqueio: c.vigiado ? { tipo: 'campo_vigiado' } : null,
        campo: { tipo: c.tipo, opcoes: c.opcoes },
      }))
    case 'criar_tarefa':
      return opcoes.membros.map((m) => ({ id: m.userId, nome: m.nome, grupo: null, bloqueio: null }))
    case 'executar_automacao':
      return opcoes.automacoes.map((a) => ({
        id: a.id,
        nome: a.nome,
        grupo: null,
        bloqueio: a.foraDaD5 ? { tipo: 'fora_da_d5', codigo: a.foraDaD5 } : null,
      }))
    case 'marcar_reuniao':
      // Os tipos de evento ATIVOS (a tela os mostra num select, não na lista
      // de caixas — `situacaoDaReuniao`). Sem Calendly legível, nenhum.
      return (opcoes.tiposDeEvento ?? []).map((e) => ({ id: e.uri, nome: e.nome, grupo: null, bloqueio: null }))
    default: {
      const nunca: never = tipo
      throw new Error(`tipo de ação desconhecido: ${String(nunca)}`)
    }
  }
}

/** O teto de linhas do PostgREST: lista com isto (ou mais) pode ter sido cortada. */
export const TETO_DO_POSTGREST = 1000

/**
 * O catálogo COMPLETO de um tipo, que PROVA que um item marcado não existe
 * mais (a poda do `ferramentasParaSalvar`). `null` = sem prova, nada é
 * descartado: a lista cortada pelo teto do PostgREST (Codex, #312) e, em
 * "Marcar reunião" (F5), o Calendly desconectado ou sem leitura — descartar
 * ali apagaria o tipo de evento bom por falta de rede.
 */
export function catalogoDoTipo(opcoes: OpcoesDasFerramentas, tipo: TipoDeAcao): ReadonlySet<string> | null {
  if (tipo === 'marcar_reuniao') {
    return opcoes.tiposDeEvento === null ? null : new Set(opcoes.tiposDeEvento.map((e) => e.uri))
  }
  const itens = itensDoTipo(opcoes, tipo)
  return itens.length < TETO_DO_POSTGREST ? new Set(itens.map((i) => i.id)) : null
}

/**
 * Agrupa pela ordem da PRIMEIRA aparição (o servidor já manda as etapas na
 * ordem do funil); item sem grupo fica num grupo `null` só dele.
 */
export function agruparItens(itens: ItemDaLista[]): Array<{ grupo: string | null; itens: ItemDaLista[] }> {
  const grupos: Array<{ grupo: string | null; itens: ItemDaLista[] }> = []
  for (const item of itens) {
    const existente = grupos.find((g) => g.grupo === item.grupo)
    if (existente) existente.itens.push(item)
    else grupos.push({ grupo: item.grupo, itens: [item] })
  }
  return grupos
}

/** As ações SIMULADAS de uma resposta do Playground; forma estranha = `undefined` (nada é mostrado). */
export function lerAcoesSimuladas(v: unknown): AcoesSimuladas | undefined {
  const o = objeto(v)
  if (!o) return undefined
  const aceitas = linhas<AcoesSimuladas['aceitas'][number]>(o.aceitas, (a) => {
    const tipo = texto(a.tipo)
    const nome = texto(a.nome)
    if (!tipo || nome === null) return null
    // O valor do campo / o título da tarefa; vazio = não veio.
    const valor = typeof a.valor === 'string' && a.valor.trim() ? a.valor : undefined
    return valor === undefined ? { tipo, nome } : { tipo, nome, valor }
  })
  const recusadas = linhas(o.recusadas, (r) => {
    const tipo = texto(r.tipo)
    const motivo = texto(r.motivo)
    return tipo !== null && motivo !== null ? { tipo, motivo } : null
  })
  if (!aceitas || !recusadas) return undefined
  return { aceitas, recusadas }
}

/**
 * As ações que um turno EXECUTOU (`cb_ia_turnos.acoes`, jsonb). `null` = o
 * turno não tem registro de ações (turno anterior à F4, ou forma estranha):
 * a expansão não aparece — nunca quebra a lista.
 */
export function lerAcoesDoTurno(v: unknown): AcaoDoTurno[] | null {
  return linhas(v, (a) => {
    const tipo = texto(a.tipo)
    const alvo = objeto(a.alvo)
    const nome = alvo ? texto(alvo.nome) : null
    if (!tipo || !alvo || nome === null || typeof a.ok !== 'boolean') return null
    const erro = typeof a.erro === 'string' && a.erro.trim() ? a.erro : undefined
    const detalhe = typeof a.detalhe === 'string' && a.detalhe.trim() ? a.detalhe : undefined
    return {
      tipo,
      alvo: { id: texto(alvo.id), nome },
      ok: a.ok,
      ...(erro ? { erro } : {}),
      ...(detalhe ? { detalhe } : {}),
    }
  })
}
