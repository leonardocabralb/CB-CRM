import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { ligar } from '@/lib/whatsapp/ligacoes/pelo-crm'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A oferta WebRTC tem uns 5–10 KB; o teto só barra o absurdo. */
const TETO_DA_OFERTA = 64 * 1024

/**
 * POST /api/cb/ligacoes/ligar  (agent+)
 *
 * Liga para o cliente da conversa pelo computador de ligações do número DELA
 * (`docs/PLANO-ligar-pelo-crm.md`, §8.14; a lógica em
 * `lib/whatsapp/ligacoes/pelo-crm.ts`).
 *
 * Body: { conversationId, oferta } — a oferta WebRTC do navegador do atendente.
 * 200 { ligacao, resposta } — o id da ligação e a resposta WebRTC da máquina.
 * Erros { error: <código> }: 400 (grupo, oferta), 404 (conversa), 409 (sem
 * computador, computador fora, linha ocupada, tocando agora, sem telefone),
 * 429 (20 por hora por número, D13), 503 (ligações não configuradas), 5xx.
 *
 * A conversa é conferida pelo cliente da SESSÃO (RLS: quem não a vê recebe
 * 404); o resto corre em service role, cercado pela conta. O recorte de
 * conexões do perfil é de visibilidade e vive na tela, como em toda rota
 * deste projeto (`cb/conversas/abrir`).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')
    const limite = checkRateLimit(`ligacoes:${userId}`, RATE_LIMITS.send)
    if (!limite.success) return rateLimitResponse(limite)
    const segredo = segredoDoCrm()
    if (!segredo) return NextResponse.json({ error: 'ligacoes_nao_configuradas' }, { status: 503 })

    const body = await request.json().catch(() => null)
    const conversationId: unknown = body?.conversationId
    const oferta: unknown = body?.oferta
    if (typeof conversationId !== 'string' || !UUID.test(conversationId)) {
      return NextResponse.json({ error: 'conversa_invalida' }, { status: 400 })
    }
    if (typeof oferta !== 'string' || !oferta.startsWith('v=0') || oferta.length > TETO_DA_OFERTA) {
      return NextResponse.json({ error: 'oferta_invalida' }, { status: 400 })
    }

    const { data: visivel, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[ligacoes/ligar] ler a conversa falhou:', error.message)
      return NextResponse.json({ error: 'falhou' }, { status: 500 })
    }
    if (!visivel) return NextResponse.json({ error: 'conversa_nao_encontrada' }, { status: 404 })

    const r = await ligar({ db: supabaseAdmin(), segredo, accountId, userId, conversationId, oferta })
    if (!r.ok) return NextResponse.json({ error: r.codigo }, { status: r.status })
    return NextResponse.json({ ligacao: r.ligacao, resposta: r.resposta })
  } catch (err) {
    return toErrorResponse(err)
  }
}
