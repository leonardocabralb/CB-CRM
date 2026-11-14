import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { comCache } from '@/lib/cb-channels/health'
import { lerConversasDaIa } from '@/lib/ia-agentes/conversas-da-ia'

/**
 * A leitura vale por CONTA durante 20 s, e as abas que pedem juntas esperam
 * a MESMA (`comCache`, com single-flight): a lista de cada membro relê a cada
 * minuto, e N abas abertas eram N leituras da conta inteira por minuto. A
 * pausa que chega pelo tempo real decide na tela, por cima (`casaComAIa`).
 * A leitura que falha não fica guardada.
 */
const TTL_DAS_CONVERSAS_DA_IA_MS = 20_000

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
      const { atendimento, pendencias } = await comCache(
        `ia-conversas:${ctx.accountId}`,
        TTL_DAS_CONVERSAS_DA_IA_MS,
        () => lerConversasDaIa(supabaseAdmin(), ctx.accountId),
      )
      return NextResponse.json({ atendimento: [...atendimento], pendencias: [...pendencias] })
    } catch (err) {
      console.error('[cb/ia/conversas] leitura falhou:', err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
