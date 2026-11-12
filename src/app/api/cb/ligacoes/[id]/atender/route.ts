import { after, NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { atender } from '@/lib/whatsapp/ligacoes/pelo-crm'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TETO_DA_OFERTA = 64 * 1024

/**
 * POST /api/cb/ligacoes/[id]/atender  (agent+)
 *
 * Atende pelo CRM a ligação que TOCA (`cb_ligacoes_ao_vivo`, estado
 * `tocando`). O primeiro que pede leva (UPDATE condicional); os outros
 * recebem 409 `ja_atendida`. A marca do atendimento pelo CRM segura a régua da
 * Evolution (o "perdida" falso, §8.4 passo 4 do plano).
 *
 * Body: { oferta }. 200 { resposta }. Erros { error: <código> }: 400, 404
 * (`nao_esta_tocando`), 409 (`ja_atendida`, `ja_encerrada`, `ocupada`,
 * `computador_fora`, `nada_tocando`, `outra_chamada`, `sem_telefone`), 503,
 * 5xx. Falhou: a marca sai e a régua de hoje decide, depois da folga, no
 * `after()`.
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { accountId, userId } = await requireRole('agent')
    const limite = checkRateLimit(`ligacoes:${userId}`, RATE_LIMITS.send)
    if (!limite.success) return rateLimitResponse(limite)
    const segredo = segredoDoCrm()
    if (!segredo) return NextResponse.json({ error: 'ligacoes_nao_configuradas' }, { status: 503 })

    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'ligacao_invalida' }, { status: 400 })
    const body = await request.json().catch(() => null)
    const oferta: unknown = body?.oferta
    if (typeof oferta !== 'string' || !oferta.startsWith('v=0') || oferta.length > TETO_DA_OFERTA) {
      return NextResponse.json({ error: 'oferta_invalida' }, { status: 400 })
    }

    const r = await atender({
      db: supabaseAdmin(),
      segredo,
      accountId,
      userId,
      ligacaoId: id,
      oferta,
      agendar: (tarefa) => after(tarefa),
    })
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.status })
    return NextResponse.json({ resposta: r.resposta })
  } catch (err) {
    return toErrorResponse(err)
  }
}
