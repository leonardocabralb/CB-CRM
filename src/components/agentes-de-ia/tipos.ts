// Formas que as telas dos agentes de IA recebem das rotas (espelho do servidor).

import type { AiProvider } from '@/lib/ai/types'
import type {
  AcessoDoAgente,
  AgenteComEtapas,
  BlocoDoAcesso,
  EtapaDoAgente,
  FerramentasDoAgente,
  Horario,
  TipoDeAcao,
} from '@/lib/ia-agentes/agente'

export type { AcessoDoAgente, BlocoDoAcesso, EtapaDoAgente, FerramentasDoAgente, Horario, TipoDeAcao }
export type { ConfigDaRetomada } from '@/lib/ia-agentes/retomada'
export { BLOCOS_DO_ACESSO, TIPOS_DE_ACAO } from '@/lib/ia-agentes/agente'

/** O agente como as rotas o devolvem: com as etapas em que atua (D24) e o acesso (F3). */
export type IaAgente = AgenteComEtapas

/**
 * As caixas do acesso (F3, 5.5), na ordem da tela; `campos` é a lista à
 * parte. Os rótulos são chave MONTADA (`acesso.bloco.<b>`, `acesso.dica.<c>`),
 * cobradas em `textos.test.ts`.
 */
export const CAIXAS_DO_ACESSO = ['ficha', 'negocio', 'etiquetas', 'cobrancas', 'reuniao'] as const satisfies readonly Exclude<
  BlocoDoAcesso,
  'campos'
>[]

/**
 * O RETRATO do que o modelo viu num turno (`cb_ia_turnos.contexto`, F3):
 * os blocos renderizados (em inglês, como foram ao modelo) e os ids dos
 * documentos de onde vieram os trechos da base. Nulo nos turnos antigos.
 */
export interface ContextoDoTurno {
  blocos: Array<{ bloco: string; texto: string }>
  documentos: string[]
  /** O texto de cada trecho da base como foi ao modelo (vazio nos retratos antigos). */
  trechos: Array<{ documento: string; texto: string }>
}

/**
 * O que a sub-aba Ferramentas (F4, D28) oferece para marcar
 * (`GET /api/cb/ia/agentes/[id]/ferramentas/opcoes`). Quem decide o que a D5
 * proíbe é o SERVIDOR: etapa com `resultado`, campo `vigiado` por lembrete e
 * automação `foraDaD5` (o código do passo, nela ou nas que ela aciona). A
 * tela só mostra. As automações que a etapa ou a etiqueta disparam não
 * contam (a D5 vale só para o que o agente faz, 27/09/2026). Os códigos
 * ficam `string` (vêm da rede): código novo cai no texto "outro".
 */
export interface OpcoesDasFerramentas {
  etapas: Array<{ id: string; nome: string; funil: string; resultado: 'ganho' | 'perdido' | null }>
  etiquetas: Array<{ id: string; nome: string }>
  /** `tipo` = `custom_fields.field_type` (nulo = não veio); `opcoes` = as da lista. */
  campos: Array<{ id: string; nome: string; vigiado: boolean; tipo: string | null; opcoes: string[] }>
  membros: Array<{ userId: string; nome: string }>
  automacoes: Array<{ id: string; nome: string; foraDaD5: string | null }>
  /**
   * "Marcar reunião" (F5, D7): o Calendly da conta. `falhou` = a leitura dos
   * tipos de evento não respondeu — nunca "não há tipos".
   */
  calendly: EstadoDoCalendly
  /** Os tipos de evento ATIVOS; `null` = desconectado ou a leitura falhou (a tela diz qual). */
  tiposDeEvento: TipoDeEventoDoCalendly[] | null
}

/** O Calendly da conta para "Marcar reunião" (F5). */
export type EstadoDoCalendly = 'conectado' | 'desconectado' | 'falhou'

/** Um tipo de evento do Calendly: a uri é o que o agente grava; `duracao` em minutos. */
export interface TipoDeEventoDoCalendly {
  uri: string
  nome: string
  duracao: number
}

/**
 * Um horário livre que o Playground ofereceu ao modelo (F5), como foi ao
 * pedido: o número e o texto (em inglês, no fuso do escritório — é o que o
 * modelo leu).
 */
export interface HorarioOferecido {
  n: number
  texto: string
}

/**
 * Uma ação que o agente EXECUTOU num turno (`cb_ia_turnos.acoes`, F4).
 * `erro` fica `string`: vem do jsonb, de qualquer versão do servidor — quem o
 * traduz é `textoDoErroDaAcao`, que cai no genérico para código desconhecido.
 * `detalhe` é o complemento cru (o passo da D5, `ja_estava`, o texto do motor).
 */
export interface AcaoDoTurno {
  tipo: string
  alvo: { id: string | null; nome: string }
  ok: boolean
  erro?: string
  detalhe?: string
}

/**
 * A retomada SIMULADA no Playground (1056): a tentativa (1-based) de quantas,
 * o texto que sairia e, quando nada sairia, o motivo (`parada`).
 */
export interface RetomadaSimulada {
  tentativa: number
  de: number
  texto: string
  parada: string | null
}

/** As ações de uma resposta do Playground — SIMULADAS, nada executa ali (F4). */
export interface AcoesSimuladas {
  /** `valor`: o valor do campo ou o título da tarefa. */
  aceitas: Array<{ tipo: string; nome: string; valor?: string }>
  recusadas: Array<{ tipo: string; motivo: string }>
}

export const PROVEDORES: readonly AiProvider[] = ['gemini', 'openai', 'anthropic']

/** Nomes próprios — não passam pelo dicionário. */
export const NOME_DO_PROVEDOR: Record<AiProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
}

/** Estado das chaves (`GET /api/cb/ia/chaves`); `null` = não se sabe. */
export type ChavesDaConta = Record<AiProvider, boolean> | null

export async function buscarChaves(): Promise<ChavesDaConta> {
  try {
    const res = await fetch('/api/cb/ia/chaves', { cache: 'no-store' })
    if (!res.ok) return null
    const corpo = (await res.json()) as {
      chaves?: { provedor: AiProvider; existe: boolean; soDaBase?: boolean }[]
    }
    const r: Record<AiProvider, boolean> = { gemini: false, openai: false, anthropic: false }
    // A chave da OpenAI que é SÓ da base não serve de chave de chat (1047).
    for (const c of corpo.chaves ?? []) if (c.provedor in r) r[c.provedor] = c.existe === true && c.soDaBase !== true
    return r
  } catch {
    return null
  }
}

/** Os modelos de partida (D do plano, 5.9): as instruções e regras moram no dicionário. */
export const MODELOS_DE_PARTIDA = ['em_branco', 'triagem', 'cobranca', 'financeiro'] as const
export type ModeloDePartida = (typeof MODELOS_DE_PARTIDA)[number]
