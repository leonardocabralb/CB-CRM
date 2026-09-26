import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { canalDaIaNaConversa } from '@/lib/ia-agentes/quem-responde'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * O "Pausar / Retomar IA" da faixa do fio (D26 do docs/PLANO-agentes-de-ia.md).
 *
 * Body: { paused: boolean }
 *   - paused: true  → pausa a IA nesta conversa com o MOTIVO `botao` (1049):
 *                     `ai_autoreply_disabled`, `ia_pausada_por` e
 *                     `ia_pausada_em`.
 *   - paused: false → RETOMA: limpa a pausa (os três campos) e carimba
 *                     `ia_retomada_em` — é dele (com a entrada do card na
 *                     etapa) que o teto de respostas volta a contar. ⚠️ É a
 *                     ÚNICA porta que desfaz as pausas `gente`, `botao` e
 *                     `transferencia` (D26): mudar o card de etapa não retoma,
 *                     e o `set_ai` das automações só desfaz a pausa dele.
 *
 * ⚠️⚠️ NOSSO: retomar NÃO solta o responsável humano. No upstream o portão do
 * auto-reply era "há alguém atribuído?", e retomar zerava `assigned_agent_id`;
 * aqui quem decide é a pausa, e zerar o responsável tiraria a conversa da
 * fila de quem a atende. Um merge que traga a rota crua devolve o
 * `assigned_agent_id = null` sem conflito nenhum — há pino em `route.test.ts`.
 *
 * As escritas vão pelo cliente SSR (sob RLS): conversa de outra conta
 * simplesmente não é achada (404).
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    // Reuse the send bucket: this is a cheap per-user inbox action and
    // toggling it in a tight loop has no legitimate use.
    const limit = checkRateLimit(`ai-takeover:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const { conversationId } = await params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.paused !== 'boolean') {
      return NextResponse.json(
        { error: 'paused (boolean) is required' },
        { status: 400 },
      )
    }
    const paused = body.paused as boolean

    // Confirm the conversation is in the caller's account before writing.
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('id, group_id, channel_id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (convErr) {
      console.error('[ai/autoreply] conversation lookup error:', convErr)
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 },
      )
    }
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    // Grupo está fora da IA por decisão de produto (migration 906). A UI
    // esconde o interruptor; isto é a segunda tranca. Depois do not-found:
    // antes dele, a checagem só não estourava por causa do `?.`, e bastava
    // alguém "limpar" o encadeamento opcional para virar crash.
    if (conv.group_id) {
      return NextResponse.json(
        { error: 'AI auto-reply is not available in group conversations', code: 'grupo' },
        { status: 400 },
      )
    }

    // O agente não responde no Direct (D1 do Instagram): pausar ou retomar ali
    // seria um botão sem efeito, e "Retomar" afirmaria que a IA voltou a
    // atender uma conversa em que ela nunca atende. Pergunta à MESMA conexão
    // que a faixa usa (`canalDaIaNaConversa`: a da última mensagem do
    // cliente, senão a da conversa) — com a fixada, a faixa oferecia o botão
    // e esta rota o recusava (Codex, #309). Sem canal é o legado de WhatsApp.
    // Só `kind`: a linha tem o token.
    let canalId: string | null
    try {
      canalId = await canalDaIaNaConversa(supabase, conversationId, conv.channel_id ?? null)
    } catch (err) {
      console.error('[ai/autoreply] last customer message lookup error:', err)
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 })
    }
    if (canalId) {
      const { data: canal, error: canalErr } = await supabase
        .from('cb_channels')
        .select('kind')
        .eq('id', canalId)
        .eq('account_id', accountId)
        .maybeSingle()
      // ⚠️ Erro de banco NÃO é "não é Instagram": falha fechada.
      if (canalErr) {
        console.error('[ai/autoreply] channel lookup error:', canalErr)
        return NextResponse.json(
          { error: 'Failed to load conversation' },
          { status: 500 },
        )
      }
      if (ehInstagram(canal)) {
        return NextResponse.json(
          { error: 'AI auto-reply is not available in Instagram conversations', code: 'instagram' },
          { status: 400 },
        )
      }
    }

    const agora = new Date().toISOString()
    const update: Record<string, unknown> = paused
      ? { ai_autoreply_disabled: true, ia_pausada_por: 'botao', ia_pausada_em: agora }
      : { ai_autoreply_disabled: false, ia_pausada_por: null, ia_pausada_em: null, ia_retomada_em: agora }

    // ⚠️ Confere as LINHAS: RLS que barra o UPDATE (ou a conversa apagada
    // entre a leitura e a escrita) volta 0 linhas com `error: null`, e a tela
    // diria "IA pausada" sobre uma conversa em que ela segue respondendo.
    const { data: gravadas, error: upErr } = await supabase
      .from('conversations')
      .update(update)
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .select('id')
    if (upErr) {
      console.error('[ai/autoreply] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update conversation' },
        { status: 500 },
      )
    }
    if (!gravadas || gravadas.length === 0) {
      return NextResponse.json(
        { error: 'Conversation was not updated', code: 'nada_gravado' },
        { status: 409 },
      )
    }

    return NextResponse.json({ success: true, paused })
  } catch (err) {
    return toErrorResponse(err)
  }
}
