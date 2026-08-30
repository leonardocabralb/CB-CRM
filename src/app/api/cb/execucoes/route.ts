// ============================================================
// GET /api/cb/execucoes?contactId= — o que está AGENDADO para o cliente.
//
// Lista as esperas pendentes de automação (`automation_pending_executions`,
// status='pending') do contato, agrupadas por automação — e, por grupo, a
// LINHA DO TEMPO da execução (o que já rodou, o que vem depois), montada de
// `automation_logs.steps_executed` + `automation_steps`. É rota, e não
// leitura sob RLS, porque a fila é service-role only desde a 006 — não há
// policy de SELECT para o navegador, e ABRIR uma seria mexer em tabela do
// upstream para ganhar exatamente o que esta rota entrega.
//
// O robô ativo NÃO passa por aqui: `flow_runs` tem policy de SELECT e
// realtime desde a 010, então o hook lê direto do navegador.
//
// Qualquer membro lê (`viewer` inclusive) — é a mesma visibilidade do resto
// do painel da conversa. As AÇÕES (parar) é que exigem `agent`.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { NomesConhecidos } from '@/lib/automations/descrever-passo'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { agruparEsperas, type EsperaPendente } from '@/lib/execucoes/agrupar'
import {
  montarLinhaDoTempo,
  type PassoDaAutomacao,
  type PassoExecutado,
} from '@/lib/execucoes/linha-do-tempo'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinhaDePasso = PassoDaAutomacao & { automation_id: string }

/**
 * Ids citados nos `step_config` → nomes legíveis, para o `descreverPasso`
 * não imprimir UUID nem carimbar "(apagado)" em alvo vivo.
 *
 * ⚠️ CADA lookup é cercado pela CONTA, mesmo sendo "só rótulo": o validador
 * de ativação NÃO confere posse do alvo, então um agent pode gravar um UUID
 * alheio no step_config de propósito — sem a cerca, esta rota viraria um
 * oráculo de nomes de outras contas (achado da revisão do Codex no PR #70).
 * `pipeline_stages` não tem account_id; a cerca vai pelo funil pai.
 */
async function carregarNomes(
  db: ReturnType<typeof supabaseAdmin>,
  passos: LinhaDePasso[],
  accountId: string,
): Promise<NomesConhecidos> {
  const tagIds = new Set<string>()
  const etapaIds = new Set<string>()
  const fluxoIds = new Set<string>()
  const autoIds = new Set<string>()

  for (const p of passos) {
    const cfg = (p.step_config ?? {}) as Record<string, unknown>
    if (typeof cfg.tag_id === 'string') tagIds.add(cfg.tag_id)
    if (typeof cfg.stage_id === 'string') etapaIds.add(cfg.stage_id)
    if (typeof cfg.flow_id === 'string') fluxoIds.add(cfg.flow_id)
    if (typeof cfg.automation_id === 'string') autoIds.add(cfg.automation_id)
  }

  const paraMapa = (
    rotulo: string,
    res: { data: unknown; error: { message: string } | null },
  ) => {
    if (res.error) {
      // Rótulo é decorativo: sem ele a linha mostra "(apagado)", que é
      // pior que o certo mas melhor que derrubar a aba inteira.
      console.error(`[execucoes] nomes de ${rotulo} falharam:`, res.error.message)
      return {}
    }
    return Object.fromEntries(
      ((res.data ?? []) as { id: string; name: string }[]).map((r) => [
        r.id,
        r.name,
      ]),
    )
  }

  const vazio = { data: [], error: null } as const
  const [tagsRes, etapasRes, fluxosRes, autosRes] = await Promise.all([
    tagIds.size
      ? db.from('tags').select('id, name').in('id', [...tagIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
    etapaIds.size
      ? db
          .from('pipeline_stages')
          .select('id, name, pipelines!inner(account_id)')
          .in('id', [...etapaIds])
          .eq('pipelines.account_id', accountId)
      : Promise.resolve(vazio),
    fluxoIds.size
      ? db.from('flows').select('id, name').in('id', [...fluxoIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
    autoIds.size
      ? db.from('automations').select('id, name').in('id', [...autoIds]).eq('account_id', accountId)
      : Promise.resolve(vazio),
  ])

  return {
    tags: paraMapa('tags', tagsRes),
    etapas: paraMapa('pipeline_stages', etapasRes),
    fluxos: paraMapa('flows', fluxosRes),
    automacoes: paraMapa('automations', autosRes),
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const contactId = new URL(request.url).searchParams.get('contactId') ?? ''
    if (!UUID_RE.test(contactId)) {
      return NextResponse.json({ error: 'invalid_contact' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automation_pending_executions')
      .select(
        'id, automation_id, run_at, next_step_position, parent_step_id, branch, log_id, automations(name)',
      )
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .order('run_at', { ascending: true })

    // Erro de banco NÃO é "não há esperas" — devolver [] aqui faria a aba
    // afirmar "nada em execução" durante um timeout do PostgREST.
    if (error) {
      console.error('[execucoes] GET falhou:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    const grupos = agruparEsperas((data ?? []) as unknown as EsperaPendente[])
    if (grupos.length === 0) return NextResponse.json({ grupos: [] })

    // ---- Linha do tempo por grupo -------------------------------------
    const automationIds = grupos.map((g) => g.automationId)
    const logIds = grupos
      .map((g) => g.referencia?.log_id)
      .filter((v): v is string => typeof v === 'string')

    const [stepsRes, logsRes] = await Promise.all([
      db
        .from('automation_steps')
        .select(
          'id, automation_id, parent_step_id, branch, step_type, step_config, position',
        )
        .in('automation_id', automationIds),
      logIds.length > 0
        ? db
            .from('automation_logs')
            .select('id, steps_executed')
            .in('id', logIds)
            .eq('account_id', ctx.accountId)
        : Promise.resolve({ data: [], error: null } as const),
    ])

    // A linha do tempo é enriquecimento: se a carga dela falhar, a lista de
    // esperas (a informação de decisão) segue de pé, sem expansão.
    if (stepsRes.error || logsRes.error) {
      console.error(
        '[execucoes] linha do tempo falhou:',
        stepsRes.error?.message ?? logsRes.error?.message,
      )
      return NextResponse.json({ grupos })
    }

    const passos = (stepsRes.data ?? []) as unknown as LinhaDePasso[]
    const nomes = await carregarNomes(db, passos, ctx.accountId)
    const executadosPorLog = new Map(
      ((logsRes.data ?? []) as { id: string; steps_executed: PassoExecutado[] }[]).map(
        (l) => [l.id, l.steps_executed ?? []],
      ),
    )

    const comLinha = grupos.map((g) => {
      if (!g.referencia) return g
      return {
        ...g,
        linha: montarLinhaDoTempo({
          passos: passos.filter((p) => p.automation_id === g.automationId),
          espera: g.referencia,
          executados: g.referencia.log_id
            ? (executadosPorLog.get(g.referencia.log_id) ?? [])
            : [],
          nomes,
        }),
      }
    })

    return NextResponse.json({ grupos: comLinha })
  } catch (err) {
    return toErrorResponse(err)
  }
}
