import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { lerVoltaAposMin, VOLTA_APOS_MIN_TETO } from '@/lib/ia-agentes/pausa'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET/PUT /api/cb/ia/pausa  `{ minutos: number }`  (admin)
 *
 * A pausa TEMPORÁRIA da IA (1138), configuração da CONTA — vale para todo
 * agente: em quantos minutos sem resposta da equipe a IA volta a responder
 * (e faz o follow-up da fala da equipe). 0 = desligado: toda pausa fica até o
 * "Retomar IA", como antes. Mora na linha PADRÃO de `ai_configs`, ao lado da
 * cotação, e é gravada SOZINHA: o `POST /api/ai/config` reescreve a linha
 * inteira (ele não conhece a coluna, e não a toca).
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    try {
      return NextResponse.json({ minutos: await lerVoltaAposMin(ctx.supabase, ctx.accountId) })
    } catch (err) {
      console.error('[cb/ia/pausa] leitura falhou:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-pausa:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const corpo = (await request.json().catch(() => null)) as { minutos?: unknown } | null
    const minutos = corpo?.minutos
    if (typeof minutos !== 'number' || !Number.isInteger(minutos) || minutos < 0 || minutos > VOLTA_APOS_MIN_TETO) {
      return NextResponse.json({ error: 'minutos_invalidos', code: 'minutos_invalidos' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase
      .from('ai_configs')
      .update({ ia_volta_apos_min: minutos })
      .eq('account_id', ctx.accountId)
      .is('channel_id', null)
      .select('id')
    if (error) {
      console.error('[cb/ia/pausa] gravação falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    // Sem a linha padrão (nenhuma chave cadastrada ainda) não há onde gravar;
    // RLS que barra também volta zero linhas sem erro.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'sem_configuracao', code: 'sem_configuracao' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, minutos })
  } catch (err) {
    return toErrorResponse(err)
  }
}
