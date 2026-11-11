import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { lerTranscricao } from '@/lib/whatsapp/ligacoes/dialogos-gravados'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/cb/ligacoes/[id]/transcricao  (viewer+)
 *
 * O diálogo da ligação pelo CRM (4d): os trechos (quem, início em segundos,
 * texto) e o resumo, para o "Ver transcrição" da faixa. `cb_ligacoes` é
 * FECHADA ao navegador: a leitura é em service role, cercada pela conta do
 * membro. Lê quem vê a conversa — a régua do ▶ (`../gravacao`): a conversa da
 * ligação é conferida pelo cliente da SESSÃO (RLS), e quem não a vê recebe o
 * MESMO 404 de quem pede uma ligação sem transcrição.
 *
 * 200 { trechos, resumo } · 404 { error: 'nao_encontrada' } (não existe, não
 * está pronta, já expirou ou a conversa não é visível) · 500 { error:
 * 'falhou' }. Erro de leitura NUNCA vira 404: a tela afirmaria "sem
 * transcrição" sobre uma que existe.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'ligacao_invalida' }, { status: 400 })

    const r = await lerTranscricao(supabaseAdmin(), accountId, id)
    if (r === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
    if (!r || !r.conversationId) return NextResponse.json({ error: 'nao_encontrada' }, { status: 404 })

    const { data: visivel, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', r.conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'falhou' }, { status: 500 })
    if (!visivel) return NextResponse.json({ error: 'nao_encontrada' }, { status: 404 })

    return NextResponse.json(
      { trechos: r.trechos, resumo: r.resumo },
      { headers: { 'cache-control': 'private, no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
