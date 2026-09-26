import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerDocumentosPedidos } from '@/lib/ia-agentes/agente'
import { gravarDocumentosDoAgente, lerDocumentosDoAgente, obterAgente } from '@/lib/ia-agentes/repo'
import { recusa, respostaDoErro } from '@/lib/ia-agentes/resposta'

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const naoEncontrado = () => NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })

/**
 * A base de conhecimento do agente (F3, D20) — só administrador (D14).
 *
 * `GET` → `{ documentoIds }`: os documentos da conta marcados para ele.
 * `PUT { documentoIds }` (a lista INTEIRA) → `{ documentoIds }` gravados.
 * Documento que não é da conta → 400 `documento_invalido`; lista fora da
 * forma → 400 `lista_invalida`. Nada marcado = o agente não usa base nenhuma.
 * `cb_ia_agente_documentos` é fechada ao navegador: só esta rota a toca.
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    if (!UUID.test(id)) return naoEncontrado()
    const agente = await obterAgente(ctx.accountId, id)
    if (!agente || agente.arquivadoEm) return naoEncontrado()
    return NextResponse.json({ documentoIds: await lerDocumentosDoAgente(ctx.accountId, id) })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}

export async function PUT(request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-agentes:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const { id } = await params
    if (!UUID.test(id)) return naoEncontrado()

    const pedidos = lerDocumentosPedidos(await request.json().catch(() => null))
    if (!pedidos) return recusa('lista_invalida')
    const documentoIds = await gravarDocumentosDoAgente(ctx.accountId, id, pedidos)
    return NextResponse.json({ documentoIds })
  } catch (err) {
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
