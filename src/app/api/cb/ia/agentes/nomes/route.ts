import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'

/**
 * GET /api/cb/ia/agentes/nomes  (qualquer membro)
 *
 * `{ agentes: [{ id, nome }] }` — os agentes de IA da conta, ARQUIVADOS
 * inclusive (a mensagem antiga de um agente arquivado continua com o nome
 * dele na bolha). É por aqui que quem não é admin sabe o nome: a tabela só
 * dá SELECT ao administrador (D14), e instruções e regras não saem daqui.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await supabaseAdmin()
      .from('cb_ia_agentes')
      .select('id, nome')
      .eq('account_id', ctx.accountId)
    if (error) {
      console.error('[cb/ia/agentes/nomes] leitura falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    const agentes = ((data ?? []) as { id: unknown; nome: unknown }[])
      .filter((l): l is { id: string; nome: string } => typeof l.id === 'string' && typeof l.nome === 'string')
      .map((l) => ({ id: l.id, nome: l.nome }))
    return NextResponse.json({ agentes })
  } catch (err) {
    return toErrorResponse(err)
  }
}
