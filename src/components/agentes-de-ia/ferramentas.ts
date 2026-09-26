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

import type { AcaoDoTurno, AcoesSimuladas, OpcoesDasFerramentas, TipoDeAcao } from './tipos'

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function texto(v: unknown): string | null {
  return typeof v === 'string' ? v : null
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
  const etiquetas = linhas(o.etiquetas, (e) => {
    const id = texto(e.id)
    const nome = texto(e.nome)
    return id && nome !== null ? { id, nome } : null
  })
  const campos = linhas(o.campos, (c) => {
    const id = texto(c.id)
    const nome = texto(c.nome)
    // Só o booleano `true` bloqueia; qualquer outra coisa não inventa bloqueio.
    return id && nome !== null ? { id, nome, vigiado: c.vigiado === true } : null
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
    const foraDaD5 = typeof a.foraDaD5 === 'string' && a.foraDaD5.trim() ? a.foraDaD5 : null
    return { id, nome, foraDaD5 }
  })
  if (!etapas || !etiquetas || !campos || !membros || !automacoes) return null
  return { etapas, etiquetas, campos, membros, automacoes }
}

/**
 * Por que um item NÃO pode ser marcado (a D5, calculada pelo servidor):
 * etapa de ganho/perdido, campo de data vigiado por lembrete, automação com
 * passo fora da D5 (o código do passo).
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
    default: {
      const nunca: never = tipo
      throw new Error(`tipo de ação desconhecido: ${String(nunca)}`)
    }
  }
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
  const aceitas = linhas(o.aceitas, (a) => {
    const tipo = texto(a.tipo)
    const nome = texto(a.nome)
    return tipo && nome !== null ? { tipo, nome } : null
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
    return { tipo, alvo: { id: texto(alvo.id), nome }, ok: a.ok, ...(erro ? { erro } : {}) }
  })
}
