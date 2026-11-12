import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { computadoresDaConta } from '@/lib/whatsapp/ligacoes/operacao'

/**
 * GET /api/cb/ligacoes/conexoes  (admin)
 *
 * A seção "Ligações pelo CRM" da tela Conexões (4e, `docs/PLANO-ligar-pelo-crm.md`
 * §8.17): o computador de ligações de cada conexão da conta, ligado ou não (o
 * interruptor da 1137), com a situação do ligado. Conexão sem computador não
 * vem: a tela diz que o número ainda não tem um (D17). Nunca o endereço nem o
 * nome do contêiner. Sem o `LIGACOES_SEGREDO` a instalação não liga:
 * `configurado: false`. Falha de leitura é 500, nunca a lista vazia.
 *
 * 200 { configurado, computadores: [{ channel_id, ligado, ligado_em, situacao, sinal_em }] }
 */
export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    if (!segredoDoCrm()) return NextResponse.json({ configurado: false, computadores: [] })
    const computadores = await computadoresDaConta(supabaseAdmin(), accountId, Date.now())
    if (computadores === 'falhou') return NextResponse.json({ error: 'falhou' }, { status: 500 })
    return NextResponse.json(
      { configurado: true, computadores },
      { headers: { 'cache-control': 'private, no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
