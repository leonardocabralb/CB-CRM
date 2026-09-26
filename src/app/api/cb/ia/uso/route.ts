import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { FUSO_DO_ESCRITORIO } from '@/lib/ia-agentes/pedido'
import { listarAgentes } from '@/lib/ia-agentes/repo'
import { lerLinhaDeUso, resumirUso, type LinhaDeUso } from '@/lib/ia-agentes/uso'

const DIAS_PADRAO = 30
// O `max_rows` do PostgREST vale para RPC também: a soma vem em páginas.
const PAGINA = 1000
const MAX_PAGINAS = 20

type Db = ReturnType<typeof supabaseAdmin>

/**
 * Todas as linhas de `cb_ia_uso`, página a página, sobre a ordem TOTAL da
 * função (as cinco chaves do grupo). `null` = não deu para ler TUDO (erro, ou
 * mais páginas que o teto): a tela diz que falhou em vez de mostrar um total
 * menor com cara de certo — e, com a ordem por dia, quem sobraria de fora
 * seriam justamente os dias mais recentes.
 */
async function lerUsoInteiro(
  db: Db,
  args: { p_account_id: string; p_desde: string; p_fuso: string },
): Promise<Record<string, unknown>[] | null> {
  const todas: Record<string, unknown>[] = []
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * PAGINA
    const { data, error, count } = await db
      .rpc('cb_ia_uso', args, { count: 'exact' })
      .order('dia', { ascending: true })
      .order('modo', { ascending: true })
      .order('ia_agente_id', { ascending: true, nullsFirst: false })
      .order('provedor', { ascending: true })
      .order('modelo', { ascending: true })
      .range(de, de + PAGINA - 1)
    if (error) {
      console.error('[cb/ia/uso] leitura falhou:', error.message)
      return null
    }
    const linhas = (data ?? []) as Record<string, unknown>[]
    todas.push(...linhas)
    if (linhas.length < PAGINA || (count !== null && todas.length >= count)) return todas
  }
  console.error(`[cb/ia/uso] mais de ${MAX_PAGINAS * PAGINA} linhas — não dá para somar tudo`)
  return null
}

/**
 * GET /api/cb/ia/uso?dias=30  (admin)
 *
 * O uso de IA da conta, SOMADO NO BANCO (`cb_ia_uso`, 1043): por modo, por
 * agente (produção e teste separados, D13), por dia, e o custo estimado em R$
 * pela cotação da conta (D21). A rota antiga lia linha a linha e o PostgREST
 * cortava em 1000 sem avisar.
 *
 * ⚠️ A cotação NULA não é zero: sem ela o R$ vem nulo, e a tela diz o que falta.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-uso:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const bruto = Number(new URL(request.url).searchParams.get('dias'))
    const dias = Number.isFinite(bruto) && bruto >= 1 ? Math.min(90, Math.floor(bruto)) : DIAS_PADRAO
    // Começo do dia local mais antigo, para as barras somarem o total.
    const hoje = new Date(
      new Intl.DateTimeFormat('en-CA', { timeZone: FUSO_DO_ESCRITORIO }).format(new Date()) + 'T00:00:00-03:00',
    )
    const desde = new Date(hoje.getTime() - (dias - 1) * 86_400_000)

    const db = supabaseAdmin()
    const [uso, config, agentes] = await Promise.all([
      lerUsoInteiro(db, {
        p_account_id: ctx.accountId,
        p_desde: desde.toISOString(),
        p_fuso: FUSO_DO_ESCRITORIO,
      }),
      db
        .from('ai_configs')
        .select('cotacao_dolar')
        .eq('account_id', ctx.accountId)
        .is('channel_id', null)
        .maybeSingle(),
      // O nome ATUAL de cada agente (o do log é congelado na hora da chamada:
      // renomeado, o agente apareceria com o nome velho). Falhar aqui não
      // derruba o uso — fica o nome do log.
      listarAgentes(ctx.accountId, { incluirArquivados: true }).catch((err) => {
        console.error('[cb/ia/uso] lista dos agentes falhou:', err)
        return null
      }),
    ])
    if (uso === null || config.error) {
      if (config.error) console.error('[cb/ia/uso] leitura da cotação falhou:', config.error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    const linhas = uso.map(lerLinhaDeUso).filter((l): l is LinhaDeUso => l !== null)
    const bruta = (config.data as { cotacao_dolar?: unknown } | null)?.cotacao_dolar
    const cotacao = bruta === null || bruta === undefined ? null : Number(bruta)
    const cotacaoValida = cotacao !== null && Number.isFinite(cotacao) ? cotacao : null

    const resumo = resumirUso(linhas, cotacaoValida)
    if (agentes) {
      const atuais = new Map(agentes.map((a) => [a.id, a]))
      for (const a of resumo.porAgente) {
        const atual = a.iaAgenteId ? atuais.get(a.iaAgenteId) : undefined
        if (atual) {
          a.nome = atual.nome
          a.arquivado = atual.arquivadoEm !== null
        }
      }
    }

    return NextResponse.json({
      dias,
      desde: desde.toISOString(),
      cotacao: cotacaoValida,
      resumo,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
