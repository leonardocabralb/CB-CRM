// Formas que as telas dos agentes de IA recebem das rotas (espelho do servidor).

import type { AiProvider } from '@/lib/ai/types'
import type { Horario, IaAgente } from '@/lib/ia-agentes/agente'

export type { Horario, IaAgente }

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
