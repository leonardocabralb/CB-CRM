// ============================================================
// POST /api/cb/execucoes/executar — disparar uma automação ou um robô para
// O cliente da conversa aberta, a pedido de gente (menu + do compositor).
//
// Reusa os pontos de entrada que a orquestração (936) já construiu:
// `runAutomationById` (pula triggerMatches DE PROPÓSITO — o chamador
// explícito é quem decide) e `startFlowForContact` (substitui a run ativa,
// D11). O que o motor NÃO faz, esta rota faz:
//
//   - recusa conversa de GRUPO — automação não roda em grupo por decisão
//     estrutural (cb-groups/persist.ts), e as esperas são por contato;
//   - checa o ESCOPO DE CANAL contra o canal da conversa. O motor pula esse
//     recorte no acionamento explícito, mas aqui "explícito" é um clique de
//     operador, e uma automação restrita ao número A executada na conversa
//     do número B enviaria pelo número errado. Falha ABERTA como o motor:
//     canal desconhecido (conversa pré-903) deixa passar;
//   - rotula o registro: `trigger_event = 'manual'` na automação e
//     `stopped_by_agent`/`replaced_by_agent` na run substituída do robô —
//     "teve gente ou foi regra?" precisa continuar respondível.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { channelInScope, runAutomationById, stageInScope } from '@/lib/automations/engine'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { startFlowForContact } from '@/lib/flows/engine'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { Automation } from '@/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limite = checkRateLimit(
      `cb:execucoes:${ctx.userId}`,
      RATE_LIMITS.execucao,
    )
    if (!limite.success) return rateLimitResponse(limite)

    const body = (await request.json().catch(() => null)) as {
      conversation_id?: unknown
      tipo?: unknown
      id?: unknown
    } | null

    const conversationId =
      typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    const alvoId = typeof body?.id === 'string' ? body.id : ''
    const tipo = body?.tipo
    if (
      !UUID_RE.test(conversationId) ||
      !UUID_RE.test(alvoId) ||
      (tipo !== 'automacao' && tipo !== 'robo')
    ) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const db = supabaseAdmin()

    const { data: conversa, error: convErr } = await db
      .from('conversations')
      .select('id, contact_id, group_id, channel_id')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    // Erro de banco não é "não encontrada" — a distinção evita o operador
    // achar que a conversa sumiu durante um timeout do PostgREST.
    if (convErr) {
      console.error('[execucoes] executar: conversa falhou:', convErr.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!conversa) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    if (conversa.group_id || !conversa.contact_id) {
      return NextResponse.json({ error: 'group_not_supported' }, { status: 422 })
    }

    const canalDaConversa = (conversa.channel_id as string | null) ?? null

    if (tipo === 'automacao') {
      const { data, error } = await db
        .from('automations')
        .select('*')
        .eq('id', alvoId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (error) {
        console.error('[execucoes] executar: automação falhou:', error.message)
        return NextResponse.json({ error: 'db_error' }, { status: 500 })
      }
      if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

      const alvo = data as Automation
      if (!alvo.is_active) {
        return NextResponse.json({ error: 'inactive' }, { status: 422 })
      }
      if (!channelInScope(alvo, { channel_id: canalDaConversa })) {
        return NextResponse.json(
          { error: 'channel_out_of_scope' },
          { status: 422 },
        )
      }
      // ⚠️ O MESMO recorte de etapa do motor (`automations.stage_ids` — "em
      // qual etapa o contato precisa ESTAR"), que faltava aqui: o
      // `runAutomationById` pula recortes de propósito, então uma automação
      // restrita à etapa "Fechamento" rodava à mão num lead recém-chegado —
      // o que o caminho automático recusaria. As duas direções, com motivo
      // (M16 do plano de 31/08 — uma versão deste comentário dizia "falha
      // aberta" para os dois casos): ERRO de consulta deixa passar
      // (ignorância não recusa), mas contato SEM NEGÓCIO é recusado —
      // `stageInScope` devolve false porque sem card ele não está em etapa
      // nenhuma, e isso é fato, não lacuna.
      if (
        !(await stageInScope(db, alvo, conversa.contact_id as string, {
          conversation_id: conversa.id as string,
          channel_id: canalDaConversa,
        }))
      ) {
        return NextResponse.json(
          { error: 'stage_out_of_scope' },
          { status: 422 },
        )
      }

      const r = await runAutomationById({
        automationId: alvo.id,
        accountId: ctx.accountId,
        contactId: conversa.contact_id as string,
        context: {
          conversation_id: conversa.id as string,
          channel_id: canalDaConversa,
        },
        triggerType: alvo.trigger_type,
        rotuloDoDisparo: 'manual',
      })
      if (!r.ok) {
        return NextResponse.json(
          { error: 'engine_refused', detail: r.detail },
          { status: 422 },
        )
      }
      return NextResponse.json({ ok: true, detail: r.detail })
    }

    // tipo === 'robo'
    const { data: flow, error: flowErr } = await db
      .from('flows')
      .select('id, status, channel_id')
      .eq('id', alvoId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (flowErr) {
      console.error('[execucoes] executar: flow falhou:', flowErr.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!flow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (flow.status !== 'active') {
      return NextResponse.json({ error: 'inactive' }, { status: 422 })
    }
    // `flows.channel_id` é SINGULAR (903): nulo = todos os canais. Mesma
    // falha aberta do motor quando o canal da conversa é desconhecido.
    if (
      flow.channel_id &&
      canalDaConversa &&
      flow.channel_id !== canalDaConversa
    ) {
      return NextResponse.json(
        { error: 'channel_out_of_scope' },
        { status: 422 },
      )
    }

    const r = await startFlowForContact({
      accountId: ctx.accountId,
      // O operador que clicou, não o dono do flow: é ele o autor da run.
      userId: ctx.userId,
      contactId: conversa.contact_id as string,
      conversationId: conversa.id as string,
      flowId: alvoId,
      channelId: canalDaConversa,
      substituicao: { status: 'stopped_by_agent', reason: 'replaced_by_agent' },
    })
    if (!r.ok) {
      return NextResponse.json(
        { error: 'engine_refused', detail: r.detail },
        { status: 422 },
      )
    }
    return NextResponse.json({ ok: true, detail: r.detail })
  } catch (err) {
    return toErrorResponse(err)
  }
}
