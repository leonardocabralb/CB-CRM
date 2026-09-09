// ============================================================
// GET /api/cb/execucoes/resumo — quais clientes têm automação AGENDADA.
//
// A resposta em LOTE para "tem robô rodando neste cliente?", que a lista de
// conversas e o quadro do funil precisam por LINHA. A irmã
// (`/api/cb/execucoes`) exige `contactId` e monta a linha do tempo de cada
// grupo: chamá-la por linha seriam centenas de requisições, cada uma com
// várias consultas, para pintar um ícone.
//
// ⚠️ É rota, e não leitura sob RLS, pela mesma razão da irmã:
// `automation_pending_executions` é service-role only desde a 006 — RLS
// ligada e ZERO policies. Do navegador a consulta devolve 0 linhas com
// `error: null`, ou seja: sucesso aparente, marca permanentemente apagada e
// nada a depurar. Não abrir policy para ganhar o que esta rota entrega.
//
// Qualquer membro lê (`viewer` incluso) — a mesma visibilidade da aba, e o que
// o operador pediu: "todo mundo que tem autonomia para executar precisa ver".
// ============================================================

import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * Teto de linhas lidas.
 *
 * A fila é pequena por natureza (3 linhas em produção nesta data) — ela guarda
 * só o que AINDA VAI rodar. 2000 é folgado para o escritório inteiro e existe
 * para uma automação em massa não virar resposta gigante; quando for atingido,
 * a resposta diz `truncado` em vez de calar.
 */
const TETO = 2000

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount()
    const limite = checkRateLimit(`cb:execResumo:${ctx.userId}`, RATE_LIMITS.execucao)
    if (!limite.success) return rateLimitResponse(limite)

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('automation_pending_executions')
      // ⚠️ `!inner` + `is_active`: desativar a automação NÃO poda a fila (quem
      // transforma a linha em `cancelled` é o resume, e ele só roda quando o
      // `run_at` daquela linha VENCE). Sem este recorte, o operador desligava
      // o follow-up de 90 dias — o freio que a 936 criou exatamente para isso
      // — e o raio seguia aceso por 90 dias dizendo "9 automações agendadas"
      // (achado da revisão, 09/09).
      .select('contact_id, run_at, automations!inner(is_active)')
      .eq('account_id', ctx.accountId)
      .eq('automations.is_active', true)
      .eq('status', 'pending')
      // Disparo sem contato existe (automação sem alvo) e não tem linha na
      // lista nem card no funil — não há onde pintar marca.
      .not('contact_id', 'is', null)
      .order('run_at', { ascending: true })
      .limit(TETO + 1)

    if (error) {
      // ⚠️ 500, nunca `{ contatos: {} }`: um objeto vazio aqui seria lido como
      // "nenhum cliente com automação rodando" — afirmação, e falsa.
      console.error('[execucoes/resumo] leitura falhou:', error.message)
      return NextResponse.json({ error: 'db_error' }, { status: 500 })
    }

    const linhas = (data ?? []) as Array<{ contact_id: string; run_at: string }>
    const truncado = linhas.length > TETO
    const contatos: Record<string, { esperas: number; proxima: string }> = {}

    for (const linha of truncado ? linhas.slice(0, TETO) : linhas) {
      const atual = contatos[linha.contact_id]
      if (atual) {
        atual.esperas += 1
        // A consulta já vem ordenada por `run_at`, então a primeira vista é a
        // mais cedo — mas o `min` explícito não depende dessa ordem continuar.
        if (linha.run_at < atual.proxima) atual.proxima = linha.run_at
      } else {
        contatos[linha.contact_id] = { esperas: 1, proxima: linha.run_at }
      }
    }

    return NextResponse.json({ contatos, truncado })
  } catch (err) {
    return toErrorResponse(err)
  }
}
