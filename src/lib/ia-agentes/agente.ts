// ============================================================
// O agente de IA (1048, docs/PLANO-agentes-de-ia.md, 5.2): a forma, a
// leitura da linha e a validação do que a tela manda. PURO, testado.
//
// ⚠️ "Agente" no resto do código quer dizer PESSOA (`assigned_agent_id`, o
// papel `agent`). Tudo que é agente de IA leva `ia_agente`/`IaAgente` no nome.
// ============================================================

import type { AiProvider } from '@/lib/ai/types'

export const LIMITES = {
  nome: 80,
  descricao: 1000,
  instrucoes: 20000,
  regras: 30,
  regra: 500,
  modelo: 100,
  tetoMin: 1,
  tetoMax: 100,
} as const

/** Horário de funcionamento: dias da semana (0 = domingo) e a janela do dia. */
export interface Horario {
  dias: number[]
  /** "HH:MM", no fuso do escritório. */
  inicio: string
  fim: string
}

export interface IaAgente {
  id: string
  accountId: string
  nome: string
  descricao: string
  instrucoes: string
  regras: string[]
  provedor: AiProvider
  modelo: string
  ativo: boolean
  /** VAZIO = nenhuma conexão (nunca "todas"). */
  conexoes: string[]
  /** Nulo = sempre. */
  horario: Horario | null
  tetoRespostas: number
  podePassarPara: string[]
  /** Membro que recebe a transferência; nulo = fila sem responsável. */
  transferirPara: string | null
  arquivadoEm: string | null
  createdAt: string
  updatedAt: string
}

/** Colunas lidas: nomeadas, nunca `*` (uma coluna sem GRANT derrubaria a consulta). */
export const COLUNAS_DO_AGENTE =
  'id, account_id, nome, descricao, instrucoes, regras, provedor, modelo, ativo, conexoes, horario, teto_respostas, pode_passar_para, transferir_para, arquivado_em, created_at, updated_at'

function ehProvedor(v: unknown): v is AiProvider {
  return v === 'openai' || v === 'anthropic' || v === 'gemini'
}

function listaDeTexto(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/

/** Lê o `horario` guardado; forma estranha vira nulo (= sempre), nunca exceção. */
export function lerHorario(v: unknown): Horario | null {
  if (!v || typeof v !== 'object') return null
  const h = v as Record<string, unknown>
  const dias = Array.isArray(h.dias)
    ? [...new Set(h.dias.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b)
    : []
  if (dias.length === 0) return null
  if (typeof h.inicio !== 'string' || typeof h.fim !== 'string') return null
  if (!HORA.test(h.inicio) || !HORA.test(h.fim) || h.inicio >= h.fim) return null
  return { dias, inicio: h.inicio, fim: h.fim }
}

/** Linha do banco → agente. Parse campo a campo, nunca `as`. */
export function lerLinhaDoAgente(linha: Record<string, unknown>): IaAgente | null {
  if (typeof linha.id !== 'string' || typeof linha.account_id !== 'string') return null
  if (!ehProvedor(linha.provedor)) return null
  return {
    id: linha.id,
    accountId: linha.account_id,
    nome: typeof linha.nome === 'string' ? linha.nome : '',
    descricao: typeof linha.descricao === 'string' ? linha.descricao : '',
    instrucoes: typeof linha.instrucoes === 'string' ? linha.instrucoes : '',
    regras: listaDeTexto(linha.regras),
    provedor: linha.provedor,
    modelo: typeof linha.modelo === 'string' ? linha.modelo : '',
    ativo: linha.ativo === true,
    conexoes: listaDeTexto(linha.conexoes),
    horario: lerHorario(linha.horario),
    tetoRespostas: typeof linha.teto_respostas === 'number' ? linha.teto_respostas : 10,
    podePassarPara: listaDeTexto(linha.pode_passar_para),
    transferirPara: typeof linha.transferir_para === 'string' ? linha.transferir_para : null,
    arquivadoEm: typeof linha.arquivado_em === 'string' ? linha.arquivado_em : null,
    createdAt: typeof linha.created_at === 'string' ? linha.created_at : '',
    updatedAt: typeof linha.updated_at === 'string' ? linha.updated_at : '',
  }
}

/** O que a tela pode gravar. Na edição, campo AUSENTE = não mexe. */
export interface AlteracaoDoAgente {
  nome?: string
  descricao?: string
  instrucoes?: string
  regras?: string[]
  provedor?: AiProvider
  modelo?: string
  ativo?: boolean
  conexoes?: string[]
  horario?: Horario | null
  tetoRespostas?: number
  podePassarPara?: string[]
  transferirPara?: string | null
}

export type CodigoDeRecusa =
  | 'corpo_invalido'
  | 'nome_vazio'
  | 'nome_longo'
  | 'descricao_longa'
  | 'instrucoes_longas'
  | 'regras_demais'
  | 'regra_longa'
  | 'provedor_invalido'
  | 'modelo_vazio'
  | 'teto_invalido'
  | 'horario_invalido'
  | 'lista_invalida'

export type LeituraDaAlteracao =
  | { ok: true; valor: AlteracaoDoAgente }
  | { ok: false; codigo: CodigoDeRecusa }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function lerIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  if (!v.every((x) => typeof x === 'string' && UUID.test(x))) return null
  return [...new Set(v as string[])]
}

/**
 * Lê o corpo da tela. `criacao` exige nome, provedor e modelo; na edição só
 * valida o que veio. As regras chegam aparadas e sem linha vazia — uma
 * regra em branco viraria um item "3." vazio no pedido ao modelo.
 */
export function lerAlteracao(corpo: unknown, criacao: boolean): LeituraDaAlteracao {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return { ok: false, codigo: 'corpo_invalido' }
  }
  const c = corpo as Record<string, unknown>
  const v: AlteracaoDoAgente = {}

  if ('nome' in c || criacao) {
    const nome = typeof c.nome === 'string' ? c.nome.trim() : ''
    if (!nome) return { ok: false, codigo: 'nome_vazio' }
    if (nome.length > LIMITES.nome) return { ok: false, codigo: 'nome_longo' }
    v.nome = nome
  }
  if ('descricao' in c) {
    const d = typeof c.descricao === 'string' ? c.descricao.trim() : ''
    if (d.length > LIMITES.descricao) return { ok: false, codigo: 'descricao_longa' }
    v.descricao = d
  }
  if ('instrucoes' in c) {
    const i = typeof c.instrucoes === 'string' ? c.instrucoes.trim() : ''
    if (i.length > LIMITES.instrucoes) return { ok: false, codigo: 'instrucoes_longas' }
    v.instrucoes = i
  }
  if ('regras' in c) {
    if (!Array.isArray(c.regras)) return { ok: false, codigo: 'lista_invalida' }
    const regras = c.regras
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
    if (regras.length > LIMITES.regras) return { ok: false, codigo: 'regras_demais' }
    if (regras.some((r) => r.length > LIMITES.regra)) return { ok: false, codigo: 'regra_longa' }
    v.regras = regras
  }
  if ('provedor' in c || criacao) {
    if (!ehProvedor(c.provedor)) return { ok: false, codigo: 'provedor_invalido' }
    v.provedor = c.provedor
  }
  if ('modelo' in c || criacao) {
    const m = typeof c.modelo === 'string' ? c.modelo.trim() : ''
    if (!m || m.length > LIMITES.modelo) return { ok: false, codigo: 'modelo_vazio' }
    v.modelo = m
  }
  if ('ativo' in c) v.ativo = c.ativo === true
  if ('conexoes' in c) {
    const ids = lerIds(c.conexoes)
    if (!ids) return { ok: false, codigo: 'lista_invalida' }
    v.conexoes = ids
  }
  if ('pode_passar_para' in c) {
    const ids = lerIds(c.pode_passar_para)
    if (!ids) return { ok: false, codigo: 'lista_invalida' }
    v.podePassarPara = ids
  }
  if ('transferir_para' in c) {
    if (c.transferir_para === null || c.transferir_para === '') v.transferirPara = null
    else if (typeof c.transferir_para === 'string' && UUID.test(c.transferir_para)) {
      v.transferirPara = c.transferir_para
    } else return { ok: false, codigo: 'lista_invalida' }
  }
  if ('teto_respostas' in c) {
    const n = Number(c.teto_respostas)
    if (!Number.isInteger(n) || n < LIMITES.tetoMin || n > LIMITES.tetoMax) {
      return { ok: false, codigo: 'teto_invalido' }
    }
    v.tetoRespostas = n
  }
  if ('horario' in c) {
    if (c.horario === null) v.horario = null
    else {
      const h = lerHorario(c.horario)
      if (!h) return { ok: false, codigo: 'horario_invalido' }
      v.horario = h
    }
  }
  return { ok: true, valor: v }
}

/** Alteração → colunas do banco (só as presentes). */
export function colunasDaAlteracao(a: AlteracaoDoAgente): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  if (a.nome !== undefined) c.nome = a.nome
  if (a.descricao !== undefined) c.descricao = a.descricao
  if (a.instrucoes !== undefined) c.instrucoes = a.instrucoes
  if (a.regras !== undefined) c.regras = a.regras
  if (a.provedor !== undefined) c.provedor = a.provedor
  if (a.modelo !== undefined) c.modelo = a.modelo
  if (a.ativo !== undefined) c.ativo = a.ativo
  if (a.conexoes !== undefined) c.conexoes = a.conexoes
  if (a.horario !== undefined) c.horario = a.horario
  if (a.tetoRespostas !== undefined) c.teto_respostas = a.tetoRespostas
  if (a.podePassarPara !== undefined) c.pode_passar_para = a.podePassarPara
  if (a.transferirPara !== undefined) c.transferir_para = a.transferirPara
  return c
}
