import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerAlteracao } from '@/lib/ia-agentes/agente'
import { arquivarAgente, atualizarAgente, obterAgente } from '@/lib/ia-agentes/repo'
import { recusa, respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Um agente de IA (só administrador, D14). `DELETE` ARQUIVA. */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    const agente = await obterAgente(ctx.accountId, id)
    if (!agente) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    return NextResponse.json({ agente })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })

    const lida = lerAlteracao(await request.json().catch(() => null), false)
    if (!lida.ok) return recusa(lida.codigo)
    const agente = await atualizarAgente(ctx.accountId, ctx.userId, id, lida.valor)
    return NextResponse.json({ agente })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    await arquivarAgente(ctx.accountId, ctx.userId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
