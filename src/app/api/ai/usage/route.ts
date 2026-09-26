import { NextResponse } from 'next/server'
import { diaNoFuso, FUSO_PADRAO, paraInstante } from '@/lib/agenda/fuso'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { buscarPorChave, PAGINA } from '@/lib/supabase/paginar'
import { somarDias } from '@/lib/tasks/prazo'

// Rows are aggregated in-process over the whole window.
//
// ⚠️ A janela é lida INTEIRA ou a rota falha — nunca um total parcial. O
// PostgREST corta cada resposta em 1.000 linhas, por mais que se peça: a versão
// anterior pedia 10.001 de uma vez, somava só as 1.000 mais recentes e o aviso
// de janela parcial nunca acendia (o cartão mostrava "1000 chamadas" com 1.902
// no banco). A leitura é POR CHAVE (`buscarPorChave`, até 25 mil linhas), e não
// por posição, porque a tabela recebe registros enquanto é lida.
const DEFAULT_WINDOW_DAYS = 30

interface UsageRow {
  id: string
  created_at: string
  mode: 'auto_reply' | 'draft' | 'radar' | 'transcricao'
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * GET /api/ai/usage?days=30  (admin+)
 *
 * Token-spend summary for the account's BYO key over the last `days`
 * (1–90, default 30): totals, per-mode + per-model breakdowns, and a
 * zero-filled daily series for charting. Admin-only, mirroring the
 * `ai_usage_log` SELECT policy — spend is billing-class.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')

    const url = new URL(request.url)
    const rawDays = Number(url.searchParams.get('days'))
    // Guard `>= 1`, not just `isFinite`: a missing/blank param is
    // Number(null)/Number('') === 0, which is finite — without the lower
    // bound the default would never apply and the window would collapse
    // to a single day.
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_WINDOW_DAYS

    // Align the query cutoff to the START of the oldest day we'll chart
    // (not a rolling `now - N*24h` instant). Otherwise rows in the oldest
    // partial day would be counted in the totals but fall outside every
    // daily bucket, so the chart's bars wouldn't sum to the headline total.
    //
    // ⚠️ O dia é o do FUSO DO ESCRITÓRIO, nunca o do processo. Esta rota roda
    // no servidor, e o contêiner está em UTC: os helpers de "dia local" de
    // `lib/dashboard/date-utils` (feitos para o NAVEGADOR) viravam o dia às 21h
    // de Brasília, e o uso da noite caía no dia seguinte.
    const agora = new Date()
    const primeiroDia = somarDias(diaNoFuso(agora, FUSO_PADRAO), -(days - 1))
    const since = paraInstante(primeiroDia, '00:00', FUSO_PADRAO)

    const leitura = await buscarPorChave<UsageRow>(async (depoisDe) => {
      let consulta = supabase
        .from('ai_usage_log')
        .select(
          'id, created_at, mode, provider, model, prompt_tokens, completion_tokens, total_tokens',
        )
        .eq('account_id', accountId)
        .gte('created_at', since.toISOString())
        // Fim fixo no instante do pedido: o registro gravado durante a
        // leitura fica para o próximo carregamento, e a foto é uma só.
        .lte('created_at', agora.toISOString())
      if (depoisDe) consulta = consulta.gt('id', depoisDe)
      const { data, error } = await consulta.order('id', { ascending: true }).limit(PAGINA)
      return { data: (data ?? null) as UsageRow[] | null, error }
    })

    if (!leitura.linhas) {
      console.error(
        '[ai/usage GET] leitura incompleta:',
        leitura.motivo,
        leitura.erro?.message ?? '',
      )
      return NextResponse.json(
        { error: 'Failed to load usage' },
        { status: 500 },
      )
    }

    const rows = leitura.linhas

    // Totals.
    let promptTokens = 0
    let completionTokens = 0
    let totalTokens = 0

    // Per-mode + per-model tallies.
    const byMode = {
      auto_reply: { calls: 0, tokens: 0 },
      draft: { calls: 0, tokens: 0 },
      radar: { calls: 0, tokens: 0 },
      transcricao: { calls: 0, tokens: 0 },
    }
    const modelMap = new Map<
      string,
      { model: string; provider: string; calls: number; tokens: number }
    >()

    // Zero-filled daily buckets so the chart shows quiet days as gaps,
    // not missing points. Day keys in the office time zone, oldest → newest
    // (calendar arithmetic on `YYYY-MM-DD`, never `+ 24h`).
    const daily = new Map<string, { date: string; tokens: number; calls: number }>()
    for (let i = 0; i < days; i++) {
      const key = somarDias(primeiroDia, i)
      daily.set(key, { date: key, tokens: 0, calls: 0 })
    }

    for (const r of rows) {
      promptTokens += r.prompt_tokens
      completionTokens += r.completion_tokens
      totalTokens += r.total_tokens

      // ⚠️ `mode` é restringido pelo CHECK do banco, e a 941 o ampliou
      // para incluir 'radar'. Modo novo no CHECK sem entrada aqui não é
      // linha ignorada: `byMode[r.mode]` vira undefined e o `.calls`
      // derruba a rota inteira com 500 — o painel de uso fica
      // inacessível por 30 dias, até a linha sair da janela.
      const balde = byMode[r.mode] ?? (byMode[r.mode] = { calls: 0, tokens: 0 })
      balde.calls += 1
      balde.tokens += r.total_tokens

      const mk = `${r.provider}:${r.model}`
      const m =
        modelMap.get(mk) ??
        { model: r.model, provider: r.provider, calls: 0, tokens: 0 }
      m.calls += 1
      m.tokens += r.total_tokens
      modelMap.set(mk, m)

      const bucket = daily.get(diaNoFuso(new Date(r.created_at), FUSO_PADRAO))
      if (bucket) {
        bucket.tokens += r.total_tokens
        bucket.calls += 1
      }
    }

    const byModel = [...modelMap.values()].sort((a, b) => b.tokens - a.tokens)

    return NextResponse.json({
      window_days: days,
      // A janela vem inteira ou a rota falha: não existe mais janela parcial.
      // O campo fica porque o cartão (`ai-usage.tsx`) ainda o lê.
      truncated: false,
      totals: {
        calls: rows.length,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
      by_mode: byMode,
      by_model: byModel,
      daily: [...daily.values()],
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
