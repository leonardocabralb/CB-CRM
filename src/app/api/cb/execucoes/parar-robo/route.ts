// ============================================================
// POST /api/cb/execucoes/parar-robo — encerrar o robô ativo do contato, a
// pedido de gente (botão da aba Automações da conversa).
//
// Reusa `abortActiveRunsForContact` — o MESMO caminho do passo `stop_flow`
// e do envio humano — com o status novo `stopped_by_agent` (955): parada
// DECIDIDA por pessoa, distinta da implícita (`paused_by_agent`, alguém
// respondeu) e da regra (`stopped_by_automation`). Roda em service-role
// porque `flow_runs` não tem policy de UPDATE para o navegador (010), e é
// assim que tem de ser.
// ============================================================

import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { abortActiveRunsForContact } from '@/lib/flows/parar-run'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')

    const limite = checkRateLimit(
      `cb:execucoes:${ctx.userId}`,
      RATE_LIMITS.execucao,
    )
    if (!limite.success) return rateLimitResponse(limite)

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown
    } | null

    const contactId = typeof body?.contact_id === 'string' ? body.contact_id : ''
    if (!UUID_RE.test(contactId)) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    // Nunca lança; devolve quantas encerrou. 0 = o robô terminou entre a
    // carga da aba e o clique (a lista é uma foto) — a tela avisa, não erra.
    const paradas = await abortActiveRunsForContact({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      contactId,
      status: 'stopped_by_agent',
      reason: 'stopped_by_agent',
    })

    return NextResponse.json({ ok: true, paradas })
  } catch (err) {
    return toErrorResponse(err)
  }
}
