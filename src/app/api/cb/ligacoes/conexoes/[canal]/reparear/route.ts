import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { reparearConexao } from '@/lib/whatsapp/ligacoes/operacao'

type Params = { params: Promise<{ canal: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/cb/ligacoes/conexoes/[canal]/reparear  (admin)
 *
 * O "Reparear" do computador de ligações: a máquina desconecta o WhatsApp Web
 * dela e passa a mostrar um QR novo (a tela confirma antes: as ligações pelo
 * CRM deste número param até alguém ler o QR com o celular dele). Só com a
 * linha livre (409 `em_ligacao`) e o computador ligado (409 `desligado`);
 * 409 `ja_pede_qr` quando a sessão já caiu. 502: a máquina não desconectou
 * (a sessão continua de pé).
 */
export async function POST(_request: Request, { params }: Params) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const { canal } = await params
    if (!UUID.test(canal)) return NextResponse.json({ error: 'conexao_invalida' }, { status: 400 })
    const segredo = segredoDoCrm()
    if (!segredo) return NextResponse.json({ error: 'nao_configurado' }, { status: 404 })
    const r = await reparearConexao(supabaseAdmin(), accountId, canal.toLowerCase(), segredo)
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
    console.info('[ligacoes] reparear na conexão %s por %s', canal, userId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
