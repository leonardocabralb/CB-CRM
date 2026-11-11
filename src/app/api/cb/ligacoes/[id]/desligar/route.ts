import { after, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { desligar } from '@/lib/whatsapp/ligacoes/pelo-crm'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/cb/ligacoes/[id]/desligar  (agent+)
 *
 * Desliga a ligação em curso pelo CRM. Qualquer atendente da conta desliga
 * (a ligação presa de quem saiu também). A que já acabou responde 200; a que
 * ainda TOCA é 409 (`ainda_tocando`): não há "Recusar" (D12 — recusar num
 * aparelho derruba a chamada em todos). O fim chega pelo aviso da máquina.
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { accountId } = await requireRole('agent')
    const segredo = segredoDoCrm()
    if (!segredo) return NextResponse.json({ error: 'ligacoes_nao_configuradas' }, { status: 503 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'ligacao_invalida' }, { status: 400 })

    const r = await desligar({
      db: supabaseAdmin(),
      segredo,
      accountId,
      ligacaoId: id,
      agendar: (tarefa) => after(tarefa),
    })
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.status })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
