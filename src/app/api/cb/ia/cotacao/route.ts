import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * PUT /api/cb/ia/cotacao  `{ cotacao: number | null }`  (admin)
 *
 * A cotação do dólar da conta (R$ por US$, com o IOF do cartão — D21), gravada
 * SOZINHA na linha padrão de `ai_configs`: o `POST /api/ai/config` reescreve a
 * linha inteira e apagaria as instruções do assistente. Nula = sem custo em R$.
 */
export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-cotacao:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const corpo = (await request.json().catch(() => null)) as { cotacao?: unknown } | null
    if (!corpo || !('cotacao' in corpo)) {
      return NextResponse.json({ error: 'corpo_invalido', code: 'corpo_invalido' }, { status: 400 })
    }
    let cotacao: number | null = null
    if (corpo.cotacao !== null && corpo.cotacao !== '') {
      const n = Number(typeof corpo.cotacao === 'string' ? corpo.cotacao.replace(',', '.') : corpo.cotacao)
      if (!Number.isFinite(n) || n <= 0 || n >= 100) {
        return NextResponse.json({ error: 'cotacao_invalida', code: 'cotacao_invalida' }, { status: 400 })
      }
      cotacao = Math.round(n * 10000) / 10000
    }

    const { data, error } = await ctx.supabase
      .from('ai_configs')
      .update({ cotacao_dolar: cotacao })
      .eq('account_id', ctx.accountId)
      .is('channel_id', null)
      .select('id')
    if (error) {
      console.error('[cb/ia/cotacao] gravação falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    // Sem a linha padrão (nenhuma chave cadastrada ainda) não há onde gravar;
    // RLS que barra também volta zero linhas sem erro.
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'sem_configuracao', code: 'sem_configuracao' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, cotacao })
  } catch (err) {
    return toErrorResponse(err)
  }
}
