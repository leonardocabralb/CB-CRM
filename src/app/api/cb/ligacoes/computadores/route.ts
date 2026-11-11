import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  computadorFora,
  computadorPronto,
  segredoDoCrm,
  type Computador,
} from '@/lib/whatsapp/ligacoes/computador'
import type { SituacaoDoComputador } from '@/lib/ligacoes/ao-vivo'

/**
 * GET /api/cb/ligacoes/computadores  (viewer+)
 *
 * Quais conexões têm computador de ligações e se ele está pronto — o botão
 * "Ligar" do cabeçalho da conversa (4c, `docs/PLANO-ligar-pelo-crm.md`)
 * aparece só onde há computador e fica desligado, com o porquê, quando ele
 * está fora (também para o Visualizador: "seu perfil não liga"). `cb_computadores_de_ligacao` é FECHADA ao navegador (1134): a
 * rota lê em service role, cercada pela conta, e devolve só a situação —
 * nunca o endereço nem o nome do contêiner (infraestrutura interna).
 *
 * 200 { computadores: [{ channel_id, situacao }] }, `situacao` ∈ `pronto`
 * (sinal recente e WhatsApp conectado), `fora` (sem sinal há 3 min) e
 * `sem_whatsapp` (no ar, mas o WhatsApp dele não está conectado). Sem o
 * `LIGACOES_SEGREDO` a instalação não liga: lista vazia. Falha de leitura é
 * 500 — nunca a lista vazia, que a tela leria como "não há computador".
 */
export async function GET() {
  try {
    const { accountId } = await requireRole('viewer')
    if (!segredoDoCrm()) return NextResponse.json({ computadores: [] })

    const { data, error } = await supabaseAdmin()
      .from('cb_computadores_de_ligacao')
      .select('channel_id, whatsapp, ultimo_sinal_em')
      .eq('account_id', accountId)
    if (error) {
      console.error('[ligacoes/computadores] ler os computadores falhou:', error.message)
      return NextResponse.json({ error: 'falhou' }, { status: 500 })
    }

    const agora = Date.now()
    const linhas = (data ?? []) as Pick<Computador, 'channel_id' | 'whatsapp' | 'ultimo_sinal_em'>[]
    const computadores = linhas.map((c) => {
      const situacao: SituacaoDoComputador = computadorPronto(c, agora)
        ? 'pronto'
        : computadorFora(c, agora)
          ? 'fora'
          : 'sem_whatsapp'
      return { channel_id: c.channel_id, situacao }
    })
    return NextResponse.json(
      { computadores },
      { headers: { 'cache-control': 'private, no-store' } },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
