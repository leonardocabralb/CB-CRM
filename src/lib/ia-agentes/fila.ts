// ============================================================
// A FILA de turnos do agente de IA (docs/PLANO-agentes-de-ia.md, 5.7).
//
// A ingestão NÃO espera o agente: a mensagem do cliente só grava (ou
// empurra) o turno PENDENTE da conversa naquela conexão e segue. Quem executa
// é um disparo no próprio processo depois da espera da rajada e, como rede, o
// laço rápido do agendador (`/api/automations/cron`, `rede.ts`).
//
// ⚠️ Enfileirar e reivindicar são por RPC (1049): "grava ou atualiza o
// pendente" sobre índice único PARCIAL não é alvo de upsert do PostgREST, e
// "não há outro rodando nesta conversa" não cabe num filtro. Descartar o
// pendente (`descartarPendente`) cabe: é UPDATE com filtros.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { after } from 'next/server'

/** A rajada: cada mensagem nova empurra o turno; ele roda uma vez, sobre a última. */
export const ESPERA_DA_RAJADA_MS = 8_000
/** Teto de tempo de um turno, do reivindicar ao envio. */
export const PRAZO_DO_TURNO_MS = 45_000
/** O que sobra do prazo para o envio depois de gerar (o provedor de mensagem). */
export const RESERVA_DO_ENVIO_MS = 10_000
/**
 * `rodando` além disto é órfão (processo morto). Bem acima do prazo: a
 * transcrição de um áudio sozinha pode levar ~50 s (download + Gemini).
 */
export const RECOLHER_TURNO_MS = 4 * 60_000
/** Turnos vencidos que a rede do cron roda por tique. */
export const TURNOS_POR_TIQUE = 10
/** Áudio sem arquivo: o turno reagenda por até isto, contado de `gravada_em` (E9). */
export const JANELA_DO_AUDIO_MS = 2 * 60_000
export const REAGENDAR_AUDIO_MS = 10_000
/** Folga do disparo depois do `executar_apos` (os dois relógios não são o mesmo). */
const FOLGA_DO_DISPARO_MS = 1_000

export interface TurnoNaFila {
  id: string
  executarApos: string
}

/**
 * Grava ou empurra o turno pendente (conversa, conexão). Devolve `null` em
 * erro — a mensagem fica sem resposta da IA e o alerta de atraso chama a
 * equipe; nunca lança (a ingestão não pode cair por isto).
 */
export async function enfileirarTurno(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    canalId: string
    iaAgenteId: string
    mensagemId: string
  },
): Promise<TurnoNaFila | null> {
  const { data, error } = await db.rpc('cb_ia_enfileirar_turno', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_canal_id: args.canalId,
    p_ia_agente_id: args.iaAgenteId,
    p_mensagem_id: args.mensagemId,
    p_espera_ms: ESPERA_DA_RAJADA_MS,
  })
  if (error) {
    console.error('[ia-agentes] enfileirar o turno falhou:', error.message)
    return null
  }
  const linha = (Array.isArray(data) ? data[0] : data) as { id?: unknown; executar_apos?: unknown } | null
  if (!linha || typeof linha.id !== 'string' || typeof linha.executar_apos !== 'string') {
    console.error('[ia-agentes] enfileirar o turno devolveu uma forma estranha')
    return null
  }
  return { id: linha.id, executarApos: linha.executar_apos }
}

/**
 * Descarta o turno PENDENTE (`aguardando`) da conversa nesta conexão. A
 * entrada chama quando o ROBÔ ou uma AUTOMAÇÃO respondeu à mensagem que
 * chegou: o texto de antes, na mesma rajada, não pode ganhar uma segunda
 * resposta do agente 8 s depois (Codex, #292 — o toque em botão). O que já
 * está RODANDO não é tocado aqui: o turno confere a saída do robô antes de
 * gerar e antes de enviar. Nunca lança.
 */
export async function descartarPendente(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; canalId: string },
): Promise<void> {
  try {
    const agora = new Date().toISOString()
    const { error } = await db
      .from('cb_ia_turnos')
      .update({
        status: 'descartado',
        erro: 'o robô ou uma automação respondeu',
        terminado_em: agora,
        updated_at: agora,
      })
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .eq('canal_id', args.canalId)
      .eq('status', 'aguardando')
    if (error) console.error('[ia-agentes] descartar o turno pendente falhou:', error.message)
  } catch (err) {
    console.error('[ia-agentes] descartar o turno pendente falhou:', err)
  }
}

function dormir(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Roda `executar(turnoId)` depois do `executar_apos`, em `after()` — fora do
 * caminho da ingestão. Dentro de outro `after()` (a ingestão já roda num),
 * o Next começa o callback na hora e o acompanha até o fim.
 *
 * ⚠️ Fora de pedido (`after` lança) NÃO há plano B com `await`: segurar quem
 * chamou por 8 s é o que a fila existe para evitar. A rede do cron roda o
 * turno no tique seguinte.
 */
export function agendarDisparo(
  turno: TurnoNaFila,
  executar: (turnoId: string) => Promise<void>,
): void {
  const alvo = Date.parse(turno.executarApos)
  const espera = Number.isFinite(alvo) ? Math.max(0, alvo - Date.now()) + FOLGA_DO_DISPARO_MS : ESPERA_DA_RAJADA_MS
  try {
    after(async () => {
      await dormir(espera)
      await executar(turno.id)
    })
  } catch {
    console.warn('[ia-agentes] turno agendado fora de pedido; a rede do cron o roda:', turno.id)
  }
}
