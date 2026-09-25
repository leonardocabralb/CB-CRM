import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { FUSO_DO_ESCRITORIO } from '@/lib/ia-agentes/pedido'
import { lerLinhaDeUso, resumirUso, type LinhaDeUso } from '@/lib/ia-agentes/uso'

const DIAS_PADRAO = 30

/**
 * GET /api/cb/ia/uso?dias=30  (admin)
 *
 * O uso de IA da conta, SOMADO NO BANCO (`cb_ia_uso`, 1043): por modo, por
 * agente (produção e teste separados, D13), por dia, e o custo estimado em R$
 * pela cotação da conta (D21). A rota antiga lia linha a linha e o PostgREST
 * cortava em 1000 sem avisar.
 *
 * ⚠️ A cotação NULA não é zero: sem ela o R$ vem nulo, e a tela diz o que falta.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-uso:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const bruto = Number(new URL(request.url).searchParams.get('dias'))
    const dias = Number.isFinite(bruto) && bruto >= 1 ? Math.min(90, Math.floor(bruto)) : DIAS_PADRAO
    // Começo do dia local mais antigo, para as barras somarem o total.
    const hoje = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_ESCRITORIO }).format(new Date()) + 'T00:00:00-03:00',
    )
    const desde = new Date(hoje.getTime() - (dias - 1) * 86_400_000)

    const db = supabaseAdmin()
    const [uso, config] = await Promise.all([
      db.rpc('cb_ia_uso', {
        p_account_id: ctx.accountId,
        p_desde: desde.toISOString(),
        p_fuso: FUSO_DO_ESCRITORIO,
      }),
      db
        .from('ai_configs')
        .select('cotacao_dolar')
        .eq('account_id', ctx.accountId)
        .is('channel_id', null)
        .maybeSingle(),
    ])
    if (uso.error || config.error) {
      console.error('[cb/ia/uso] leitura falhou:', uso.error?.message ?? config.error?.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    const linhas = ((uso.data ?? []) as Record<string, unknown>[])
      .map(lerLinhaDeUso)
      .filter((l): l is LinhaDeUso => l !== null)
    const bruta = (config.data as { cotacao_dolar?: unknown } | null)?.cotacao_dolar
    const cotacao = bruta === null || bruta === undefined ? null : Number(bruta)

    return NextResponse.json({
      dias,
      desde: desde.toISOString(),
      cotacao: cotacao !== null && Number.isFinite(cotacao) ? cotacao : null,
      resumo: resumirUso(linhas, cotacao !== null && Number.isFinite(cotacao) ? cotacao : null),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
