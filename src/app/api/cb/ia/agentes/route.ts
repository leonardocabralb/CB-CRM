import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerAlteracao } from '@/lib/ia-agentes/agente'
import { criarAgente, etapasDosAgentes, listarAgentesComEtapas } from '@/lib/ia-agentes/repo'
import { recusa, respostaDoErro } from '@/lib/ia-agentes/resposta'

/**
 * Agentes de IA da conta (1048, docs/PLANO-agentes-de-ia.md). Só
 * administrador (D14): as instruções e as regras ficam ocultas para quem não
 * é. `GET` lista os não arquivados, cada um com as ETAPAS em que atua (D24:
 * `etapas: { stageId, pipelineId, desde }[]`); `POST` cria.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const agentes = await listarAgentesComEtapas(ctx.accountId)
    return NextResponse.json({ agentes })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const lida = lerAlteracao(await request.json().catch(() => null), true)
    if (!lida.ok) return recusa(lida.codigo)
    const agente = await criarAgente(ctx.accountId, ctx.userId, lida.valor)
    const etapas = await etapasDosAgentes(ctx.accountId, [agente.id])
    return NextResponse.json({ agente: { ...agente, etapas: etapas.get(agente.id) ?? [] } }, { status: 201 })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
