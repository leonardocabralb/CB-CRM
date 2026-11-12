import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { lerConversasDaIa } from '@/lib/ia-agentes/conversas-da-ia'

/**
 * GET /api/cb/ia/conversas  (qualquer membro)
 *
 * `{ atendimento: string[], pendencias: string[] }` — os ids das conversas
 * ATIVAS que a IA atende agora (inclusive na pausa temporária e com turno na
 * fila) e das que ela passou para a equipe e seguem de pé. A régua mora em
 * `lerConversasDaIa`. É o dado dos filtros "Atendimento IA" e "Pendências de
 * IA" da caixa de entrada; a lista cruza com as conversas que já carregou
 * (o escopo do perfil vale lá). Sai SÓ id de conversa: a configuração dos
 * agentes é do administrador (D14).
 *
 * Leitura que falha é 500, nunca listas vazias: o filtro afirmaria "nenhuma".
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    try {
      const { atendimento, pendencias } = await lerConversasDaIa(supabaseAdmin(), ctx.accountId)
      return NextResponse.json({ atendimento: [...atendimento], pendencias: [...pendencias] })
    } catch (err) {
      console.error('[cb/ia/conversas] leitura falhou:', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
