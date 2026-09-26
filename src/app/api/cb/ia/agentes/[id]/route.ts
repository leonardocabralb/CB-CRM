import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerAlteracao } from '@/lib/ia-agentes/agente'
import { arquivarAgente, atualizarAgente, etapasDosAgentes, obterAgenteComEtapas } from '@/lib/ia-agentes/repo'
import { recusa, respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Um agente de IA (só administrador, D14), com as ETAPAS em que atua (D24).
 * `PATCH` aceita `etapas: string[]` (a lista INTEIRA): etapa de outro funil
 * que não é da conta → 400; etapa de OUTRO agente → 409 `etapa_ocupada` com o
 * nome dele. `DELETE` ARQUIVA (e o gatilho solta as etapas).
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    const agente = await obterAgenteComEtapas(ctx.accountId, id)
    // Arquivado é "não existe mais" para a tela: aberto pela URL, ele
    // pareceria vivo e editável, e todo botão responderia 404 (revisão da F1b).
    if (!agente || agente.arquivadoEm) {
      return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    }
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
    const etapas = await etapasDosAgentes(ctx.accountId, [id])
    return NextResponse.json({ agente: { ...agente, etapas: etapas.get(id) ?? [] } })
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
