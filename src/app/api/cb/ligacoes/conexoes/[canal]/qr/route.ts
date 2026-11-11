import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { segredoDoCrm } from '@/lib/whatsapp/ligacoes/computador'
import { qrDaConexao } from '@/lib/whatsapp/ligacoes/operacao'

type Params = { params: Promise<{ canal: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/cb/ligacoes/conexoes/[canal]/qr  (admin)
 *
 * O WhatsApp do computador de ligações AO VIVO (o CRM pergunta à máquina) e,
 * quando ele pede, o QR para ler com o celular do número — a tela consulta em
 * laço ENCADEADO enquanto a seção está aberta. Só do computador LIGADO (409
 * `desligado`). 502 `sem_resposta`: a máquina não respondeu.
 *
 * 200 { whatsapp: 'conectado' | 'qr' | 'carregando' | null, qr: string | null }
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { accountId } = await requireRole('admin')
    const { canal } = await params
    if (!UUID.test(canal)) return NextResponse.json({ error: 'conexao_invalida' }, { status: 400 })
    const segredo = segredoDoCrm()
    if (!segredo) return NextResponse.json({ error: 'nao_configurado' }, { status: 404 })
    const r = await qrDaConexao(supabaseAdmin(), accountId, canal.toLowerCase(), segredo)
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
    return NextResponse.json(
      { whatsapp: r.whatsapp, qr: r.qr },
      { headers: { 'cache-control': 'private, no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
