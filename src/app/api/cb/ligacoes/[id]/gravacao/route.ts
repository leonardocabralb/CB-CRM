import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { enderecoDaGravacao } from '@/lib/whatsapp/ligacoes/pelo-crm'

type Params = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/cb/ligacoes/[id]/gravacao  (viewer+)
 *
 * Ouvir a gravação: redireciona (302) para uma URL assinada de vida curta do
 * bucket PRIVADO `ligacoes`. A rota é o endereço ESTÁVEL que o player guarda;
 * cada pedido gera uma URL nova. Ouve quem vê a conversa (D7): a conversa da
 * ligação é conferida pelo cliente da SESSÃO (RLS) — quem não a vê recebe
 * 404, como quem pede uma ligação sem gravação.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'ligacao_invalida' }, { status: 400 })

    const r = await enderecoDaGravacao(supabaseAdmin(), accountId, id)
    if (r === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
    if (!r || !r.conversationId) return NextResponse.json({ error: 'sem_gravacao' }, { status: 404 })

    const { data: visivel, error } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', r.conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'falhou' }, { status: 500 })
    if (!visivel) return NextResponse.json({ error: 'sem_gravacao' }, { status: 404 })

    const resposta = NextResponse.redirect(r.url, 302)
    resposta.headers.set('cache-control', 'private, no-store')
    return resposta
  } catch (err) {
    return toErrorResponse(err)
  }
}
