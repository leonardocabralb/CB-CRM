// ============================================================
// GET /api/cb/execucoes?contactId= — o que está AGENDADO para o cliente.
//
// Lista as esperas pendentes de automação (`automation_pending_executions`,
// status='pending') do contato, agrupadas por automação. É rota, e não
// leitura sob RLS, porque a tabela é service-role only desde a 006 — não há
// policy de SELECT para o navegador, e ABRIR uma seria mexer em tabela do
// upstream para ganhar exatamente o que esta rota entrega.
//
// O robô ativo NÃO passa por aqui: `flow_runs` tem policy de SELECT e
// realtime desde a 010, então o hook lê direto do navegador.
//
// Qualquer membro lê (`viewer` inclusive) — é a mesma visibilidade do resto
// do painel da conversa. As AÇÕES (parar) é que exigem `agent`.
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { agruparEsperas, type EsperaPendente } from '@/lib/execucoes/agrupar'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()

    const contactId = new URL(request.url).searchParams.get('contactId') ?? ''
    if (!UUID_RE.test(contactId)) {
      return NextResponse.json({ error: 'invalid_contact' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automation_pending_executions')
      .select('id, automation_id, run_at, automations(name)')
      .eq('account_id', ctx.accountId)
      .eq('contact_id', contactId)
      .eq('status', 'pending')
      .order('run_at', { ascending: true })

    // Erro de banco NÃO é "não há esperas" — devolver [] aqui faria a aba
    // afirmar "nada em execução" durante um timeout do PostgREST.
    if (error) {
      console.error('[execucoes] GET falhou:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    return NextResponse.json({
      grupos: agruparEsperas((data ?? []) as unknown as EsperaPendente[]),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
