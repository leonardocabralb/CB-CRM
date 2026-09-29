// ============================================================
// GET /api/cb/execucoes/detalhe?log=<id> — o registro de UMA execução que já
// terminou, para a expansão do "Já rodou" na aba Automações da conversa
// (pedido do operador, 29/09/2026: a mini-auditoria).
//
// Lido só quando o operador abre a linha: o painel não paga nada a mais.
//
// Rota, e não leitura sob RLS: o "o que não rodou" de uma execução
// interrompida sai da FILA de esperas (`automation_pending_executions`), que é
// service-role only — e não se abre policy de SELECT nela
// (`.claude/rules/automacoes.md`). O `context` da fila é lido só para achar o
// passo que estacionou; nunca vai para a resposta (as variáveis da execução
// podem ter dado do cliente).
//
// Qualquer membro lê (`viewer` inclusive), como a rota irmã das esperas: é a
// mesma visibilidade do resto do painel da conversa.
//
// ⚠️ Toda consulta é cercada pela CONTA; o registro, antes de tudo — um id de
// outra conta é 404. Falha de leitura é 500, nunca um detalhe pela metade: a
// tela diria "nada ficou para trás" sobre o que ela não conseguiu ler.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { idsCitados } from '@/lib/automations/registro-legivel'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { itensDoHistorico, type ExecucaoEncerrada } from '@/lib/execucoes/desfecho'
import { montarDetalhe, type EsperaEncerrada } from '@/lib/execucoes/detalhe'
import type { PassoDaAutomacao } from '@/lib/execucoes/linha-do-tempo'
import { carregarNomesDoTexto, carregarNomesDosPassos } from '@/lib/execucoes/nomes-dos-passos'
import type { AutomationLogStepResult } from '@/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LinhaDoRegistro {
  id: string
  automation_id: string
  trigger_event: string | null
  created_at: string
  finalizado_em: string | null
  desfecho: ExecucaoEncerrada['desfecho']
  error_message: string | null
  steps_executed: AutomationLogStepResult[] | null
  interrompida_em: string | null
  interrompida_por: string | null
  automations: { name: string | null } | { name: string | null }[] | null
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const logId = new URL(request.url).searchParams.get('log') ?? ''
    if (!UUID_RE.test(logId)) {
      return NextResponse.json({ error: 'invalid_log' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automation_logs')
      .select(
        'id, automation_id, trigger_event, created_at, finalizado_em, desfecho, error_message, steps_executed, interrompida_em, interrompida_por, automations(name)',
      )
      .eq('id', logId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (error) {
      console.error('[execucoes/detalhe] registro:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

    const log = data as unknown as LinhaDoRegistro
    const embed = Array.isArray(log.automations) ? log.automations[0] : log.automations
    const executados = Array.isArray(log.steps_executed) ? log.steps_executed : []

    // A régua da aba decide o desfecho (a interrompida sem desfecho inclusive):
    // a expansão nunca diz outra coisa que a linha fechada.
    const [item] = itensDoHistorico([
      {
        id: log.id,
        automationId: log.automation_id,
        nomeDaAutomacao: embed?.name ?? null,
        desfecho: log.desfecho,
        finalizadoEm: log.finalizado_em,
        errorMessage: log.error_message,
        stepsExecuted: executados,
        interrompidaEm: log.interrompida_em,
        interrompidaPor: log.interrompida_por,
      },
    ])
    // Execução em curso não tem detalhe de encerrada: a linha do tempo dela é a
    // da espera (rota irmã).
    if (!item) return NextResponse.json({ error: 'not_finished' }, { status: 409 })

    const [passosRes, esperasRes] = await Promise.all([
      db
        .from('automation_steps')
        .select('id, parent_step_id, branch, step_type, step_config, position')
        .eq('automation_id', log.automation_id),
      db
        .from('automation_pending_executions')
        .select('parent_step_id, branch, next_step_position, context')
        .eq('account_id', ctx.accountId)
        .eq('log_id', log.id)
        .in('status', ['cancelled', 'failed']),
    ])
    if (passosRes.error || esperasRes.error) {
      console.error(
        '[execucoes/detalhe] plano ou fila:',
        passosRes.error?.message ?? esperasRes.error?.message,
      )
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    const passos = (passosRes.data ?? []) as unknown as PassoDaAutomacao[]
    let nomesDosPassos: Awaited<ReturnType<typeof carregarNomesDosPassos>>
    let nomesDoTexto: Awaited<ReturnType<typeof carregarNomesDoTexto>>
    try {
      // Estrito: o "(apagado)" sobre uma etiqueta viva que a consulta não leu
      // seria afirmar o que não se sabe. Os nomes do TEXTO já têm a régua dos
      // catálogos carregados (`carregados`).
      ;[nomesDosPassos, nomesDoTexto] = await Promise.all([
        carregarNomesDosPassos(db, passos, ctx.accountId, { estrito: true }),
        carregarNomesDoTexto(
          db,
          idsCitados([log.error_message, ...executados.map((e) => e?.detail)]),
          ctx.accountId,
        ),
      ])
    } catch (err) {
      console.error('[execucoes/detalhe] nomes:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    // ⚠️ Sem aviso de "a automação foi alterada depois": `automations.updated_at`
    // muda a CADA execução (`increment_automation_execution_count` passa pelo
    // gatilho `set_updated_at`), e `automation_steps` não tem carimbo de
    // edição — o aviso apareceria em toda execução (medido no preview,
    // 29/09/2026). O que fica honesto: passo que saiu da automação vira
    // `removido`, e ponto de parada sumido não vira lista.

    return NextResponse.json(
      {
        execucao: {
          id: log.id,
          automationId: log.automation_id,
          nome: embed?.name ?? null,
          gatilho: log.trigger_event,
          iniciadaEm: log.created_at,
          terminadaEm: item.quando,
          desfecho: item.desfecho,
          interrompidaPor: item.interrompidaPor ?? null,
          erro: log.error_message,
        },
        detalhe: montarDetalhe({
          passos,
          executados,
          desfecho: item.desfecho,
          esperasEncerradas: (esperasRes.data ?? []) as unknown as EsperaEncerrada[],
          nomes: nomesDosPassos,
        }),
        nomesDoTexto,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
