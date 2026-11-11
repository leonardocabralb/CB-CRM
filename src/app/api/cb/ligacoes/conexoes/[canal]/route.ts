import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { trocarInterruptor } from '@/lib/whatsapp/ligacoes/operacao'

type Params = { params: Promise<{ canal: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * PATCH /api/cb/ligacoes/conexoes/[canal]  (admin)  { ligado: boolean }
 *
 * O interruptor das ligações pelo CRM da conexão (1137, D16). Ligado, o CRM
 * liga, atende, toca a recebida e alarma; desligado, some tudo isso (a ligação
 * em curso não cai). 404 `sem_computador` quando a conexão não tem computador
 * (D17: criar um é operação na VPS).
 *
 * 200 { ligado, ligado_em }
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const { canal } = await params
    if (!UUID.test(canal)) return NextResponse.json({ error: 'conexao_invalida' }, { status: 400 })
    const corpo: unknown = await request.json().catch(() => null)
    const ligado = (corpo as { ligado?: unknown } | null)?.ligado
    if (ligado !== true && ligado !== false) {
      return NextResponse.json({ error: 'pedido_invalido' }, { status: 400 })
    }
    const r = await trocarInterruptor(supabaseAdmin(), accountId, canal.toLowerCase(), ligado, new Date().toISOString())
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
    console.info('[ligacoes] interruptor %s na conexão %s por %s', ligado ? 'LIGADO' : 'desligado', canal, userId)
    return NextResponse.json({ ligado: r.ligado_em !== null, ligado_em: r.ligado_em })
  } catch (err) {
    return toErrorResponse(err)
  }
}
