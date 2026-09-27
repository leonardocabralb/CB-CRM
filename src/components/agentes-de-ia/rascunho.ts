// ============================================================
// O que mudou na Configuração de um agente (F1b). PURO, testado.
//
// O Salvar manda SÓ o que mudou em relação ao que está salvo. Mandar tudo
// travava a tela quando um valor guardado deixava de valer por fora dela: o
// membro que recebia as transferências saiu da equipe, e TODO salvamento —
// até o de uma vírgula nas instruções — voltava 400 `membro_de_outra_conta`
// (revisão da F1b). E é o que diz à aba Playground que há alteração não
// salva.
//
// ⚠️ A comparação espelha o que a rota faz com o valor (`lerAlteracao`): texto
// aparado, regra vazia descartada, lista de ids sem ordem. Sem isso, um
// espaço no fim do nome contaria como "mudou" para sempre.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'
import {
  CAIXAS_DO_ACESSO,
  TIPOS_DE_ACAO,
  type AcessoDoAgente,
  type FerramentasDoAgente,
  type Horario,
  type IaAgente,
  type TipoDeAcao,
} from './tipos'

export interface Rascunho {
  nome: string
  descricao: string
  instrucoes: string
  regras: string[]
  provedor: AiProvider
  modelo: string
  ativo: boolean
  conexoes: string[]
  horario: Horario | null
  tetoRespostas: number
  transferirPara: string | null
  podePassarPara: string[]
  /** Ids das etapas em que o agente atua (D24). */
  etapas: string[]
}

function regrasLimpas(regras: string[]): string[] {
  return regras.map((r) => r.trim()).filter((r) => r.length > 0)
}

/** Listas de ids que são CONJUNTO (a ordem não conta). */
export function mesmoConjunto(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function mesmoHorario(a: Horario | null, b: Horario | null): boolean {
  if (a === null || b === null) return a === b
  return a.inicio === b.inicio && a.fim === b.fim && mesmoConjunto(a.dias.map(String), b.dias.map(String))
}

/**
 * O corpo do PATCH: só as chaves que mudaram, com os nomes da rota. Vazio =
 * nada a salvar.
 */
export function alteracoesDoRascunho(salvo: IaAgente, r: Rascunho): Record<string, unknown> {
  const corpo: Record<string, unknown> = {}
  if (r.nome.trim() !== salvo.nome) corpo.nome = r.nome
  if (r.descricao.trim() !== salvo.descricao) corpo.descricao = r.descricao
  if (r.instrucoes.trim() !== salvo.instrucoes) corpo.instrucoes = r.instrucoes
  const regras = regrasLimpas(r.regras)
  if (regras.length !== salvo.regras.length || regras.some((x, i) => x !== salvo.regras[i])) {
    corpo.regras = regras
  }
  if (r.provedor !== salvo.provedor) corpo.provedor = r.provedor
  if (r.modelo.trim() !== salvo.modelo) corpo.modelo = r.modelo
  if (r.ativo !== salvo.ativo) corpo.ativo = r.ativo
  if (!mesmoConjunto(r.conexoes, salvo.conexoes)) corpo.conexoes = r.conexoes
  if (!mesmoHorario(r.horario, salvo.horario)) corpo.horario = r.horario
  if (r.tetoRespostas !== salvo.tetoRespostas) corpo.teto_respostas = r.tetoRespostas
  if (r.transferirPara !== salvo.transferirPara) corpo.transferir_para = r.transferirPara
  if (!mesmoConjunto(r.podePassarPara, salvo.podePassarPara)) corpo.pode_passar_para = r.podePassarPara
  // As etapas vão INTEIRAS (a rota apaga as que saíram e insere as novas).
  if (!mesmoConjunto(r.etapas, salvo.etapas.map((e) => e.stageId))) corpo.etapas = r.etapas
  return corpo
}

/** "12" → 12; vazio, fração ou fora de 1..100 → `null` (o campo avisa, o Salvar trava). */
export function lerTeto(texto: string, min: number, max: number): number | null {
  const t = texto.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= min && n <= max ? n : null
}

// ------------------------------------------------------------
// Acesso (F3, sub-aba Acesso): o que o agente vê do cliente.
// ------------------------------------------------------------

/** O rascunho do Acesso difere do salvo? Os campos são conjunto. */
export function acessoMudou(salvo: AcessoDoAgente, r: AcessoDoAgente): boolean {
  return CAIXAS_DO_ACESSO.some((c) => r[c] !== salvo[c]) || !mesmoConjunto(r.campos, salvo.campos)
}

/**
 * O acesso que vai no PATCH: sem os campos que não existem mais no catálogo
 * (o servidor os ignora na leitura, mas ocupariam vagas do teto).
 *
 * ⚠️ Catálogo NÃO carregado (`null`) = vai como está: descartar ali seria
 * apagar marcação boa por falta de rede. E a poda é só no SALVAR, nunca na
 * comparação de `acessoMudou` — senão o agente com um campo apagado nasceria
 * "com alteração não salva" sem ninguém ter mexido.
 */
export function acessoParaSalvar(r: AcessoDoAgente, existentes: ReadonlySet<string> | null): AcessoDoAgente {
  if (existentes === null) return r
  return { ...r, campos: r.campos.filter((id) => existentes.has(id)) }
}

// ------------------------------------------------------------
// Ferramentas (F4, D28, sub-aba Ferramentas): o que o agente pode FAZER.
// ------------------------------------------------------------

/** A lista de ids de um tipo de ação; `null` = o tipo está desligado. */
export function listaDaFerramenta(f: FerramentasDoAgente, tipo: TipoDeAcao): string[] | null {
  switch (tipo) {
    case 'mover_etapa':
      return f.mover_etapa ? f.mover_etapa.etapas : null
    case 'etiquetar':
      return f.etiquetar ? f.etiquetar.etiquetas : null
    case 'tirar_etiqueta':
      return f.tirar_etiqueta ? f.tirar_etiqueta.etiquetas : null
    case 'preencher_campo':
      return f.preencher_campo ? f.preencher_campo.campos : null
    case 'criar_tarefa':
      return f.criar_tarefa ? f.criar_tarefa.membros : null
    case 'executar_automacao':
      return f.executar_automacao ? f.executar_automacao.automacoes : null
    case 'marcar_reuniao':
      return f.marcar_reuniao ? f.marcar_reuniao.tipos_de_evento : null
    default: {
      const nunca: never = tipo
      throw new Error(`tipo de ação desconhecido: ${String(nunca)}`)
    }
  }
}

/** `f` com o tipo LIGADO e esta lista (os nomes das chaves são os do servidor). */
function comLista(f: FerramentasDoAgente, tipo: TipoDeAcao, ids: string[]): FerramentasDoAgente {
  switch (tipo) {
    case 'mover_etapa':
      return { ...f, mover_etapa: { etapas: ids } }
    case 'etiquetar':
      return { ...f, etiquetar: { etiquetas: ids } }
    case 'tirar_etiqueta':
      return { ...f, tirar_etiqueta: { etiquetas: ids } }
    case 'preencher_campo':
      return { ...f, preencher_campo: { campos: ids } }
    case 'criar_tarefa':
      return { ...f, criar_tarefa: { membros: ids } }
    case 'executar_automacao':
      return { ...f, executar_automacao: { automacoes: ids } }
    case 'marcar_reuniao':
      return { ...f, marcar_reuniao: { tipos_de_evento: ids } }
    default: {
      const nunca: never = tipo
      throw new Error(`tipo de ação desconhecido: ${String(nunca)}`)
    }
  }
}

/**
 * O rascunho da sub-aba: quais tipos estão ligados e a lista de CADA tipo.
 * A lista fica guardada também com a chave desligada — desligar e religar
 * antes de salvar não perde as marcações (só as ligadas vão no Salvar).
 */
export interface RascunhoDasFerramentas {
  ligadas: TipoDeAcao[]
  listas: Record<TipoDeAcao, string[]>
}

export function rascunhoDasFerramentas(f: FerramentasDoAgente): RascunhoDasFerramentas {
  const listas = {} as Record<TipoDeAcao, string[]>
  const ligadas: TipoDeAcao[] = []
  for (const tipo of TIPOS_DE_ACAO) {
    const lista = listaDaFerramenta(f, tipo)
    listas[tipo] = lista ? [...lista] : []
    if (lista) ligadas.push(tipo)
  }
  return { ligadas, listas }
}

/** O que o rascunho significa para o servidor: só os tipos ligados, cada um com a sua lista. */
export function ferramentasDoRascunho(r: RascunhoDasFerramentas): FerramentasDoAgente {
  let f: FerramentasDoAgente = {}
  for (const tipo of TIPOS_DE_ACAO) if (r.ligadas.includes(tipo)) f = comLista(f, tipo, r.listas[tipo])
  return f
}

/**
 * As ferramentas mudaram? Por tipo: ligado × desligado conta, e a lista é
 * CONJUNTO (a ordem não conta). Ligado com a lista vazia é diferente de
 * desligado — é o que o servidor recebe.
 */
export function ferramentasMudaram(salvo: FerramentasDoAgente, r: FerramentasDoAgente): boolean {
  return TIPOS_DE_ACAO.some((tipo) => {
    const a = listaDaFerramenta(salvo, tipo)
    const b = listaDaFerramenta(r, tipo)
    if (a === null || b === null) return a !== b
    return !mesmoConjunto(a, b)
  })
}

/**
 * As ferramentas que vão no PATCH: sem os itens que não existem mais na
 * conta (a etiqueta apagada, o campo removido). Eles não aparecem na lista —
 * não haveria como desmarcá-los —, e o servidor os recusaria
 * (`item_de_outra_conta`), travando todo salvamento.
 *
 * ⚠️ Catálogo NÃO carregado, ou cortado pelo teto do PostgREST (`null` para
 * aquele tipo) = a lista vai como está: descartar ali seria apagar marcação
 * boa por falta de prova (a lição do `acessoParaSalvar`, Codex #312). E a
 * poda é só no SALVAR, nunca em `ferramentasMudaram`.
 */
export function ferramentasParaSalvar(
  f: FerramentasDoAgente,
  existentes: Partial<Record<TipoDeAcao, ReadonlySet<string> | null>>,
): FerramentasDoAgente {
  let saida: FerramentasDoAgente = {}
  for (const tipo of TIPOS_DE_ACAO) {
    const lista = listaDaFerramenta(f, tipo)
    if (lista === null) continue
    const catalogo = existentes[tipo] ?? null
    saida = comLista(saida, tipo, catalogo ? lista.filter((id) => catalogo.has(id)) : [...lista])
  }
  return saida
}
