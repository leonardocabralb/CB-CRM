import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

type Params = { params: Promise<{ conversationId: string }> }

/**
 * POST /api/ai/autoreply/[conversationId]  (agent+)
 *
 * O botão "Pausar/Retomar IA" do cabeçalho do fio (5.4 do
 * docs/PLANO-agentes-de-ia.md).
 *
 * Body: { paused: boolean, assign_to_me?: boolean }
 *   - paused: true  → pausa a IA nesta conversa com o MOTIVO `botao` (1049):
 *                     `ai_autoreply_disabled`, `ia_pausada_por` e
 *                     `ia_pausada_em`. Com `assign_to_me`, também atribui a
 *                     conversa a quem clicou (o "assumir" de antes), o que
 *                     dispara o gatilho `on_conversation_assigned`.
 *   - paused: false → RETOMA: limpa a pausa (os três campos), zera o contador
 *                     de respostas e o resumo da passagem. ⚠️ É a ÚNICA porta
 *                     que desfaz as pausas `botao` e `transferencia` — o passo
 *                     "Atribuir agente" e o `set_ai` das automações não as
 *                     tocam (E12/E13), porque foram decisões de gente.
 *
 * ⚠️⚠️ NOSSO (F2a dos agentes de IA, E13): retomar NÃO solta mais o
 * responsável humano. No upstream o portão do auto-reply era "há alguém
 * atribuído?", e retomar precisava zerar `assigned_agent_id` — senão o robô
 * seguia mudo. Desde a F2 quem decide é a pausa (5.3), e zerar o responsável
 * tiraria a conversa da fila de quem a atende. Um merge que traga a rota crua
 * devolve o `assigned_agent_id = null` sem conflito nenhum — há pino em
 * `route.test.ts`.
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
    const assignToMe = body.assign_to_me === true

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
    // atender uma conversa em que ela nunca atende. Pergunta à CONEXÃO da
    // conversa — a do Instagram sempre carrega o `channel_id` (persistir.ts);
    // sem canal é o legado de WhatsApp. Só `kind`: a linha tem o token.
    if (conv.channel_id) {
      const { data: canal, error: canalErr } = await supabase
        .from('cb_channels')
        .select('kind')
        .eq('id', conv.channel_id)
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

    const update: Record<string, unknown> = paused
      ? {
          ai_autoreply_disabled: true,
          ia_pausada_por: 'botao',
          ia_pausada_em: new Date().toISOString(),
        }
      : {
          ai_autoreply_disabled: false,
          ia_pausada_por: null,
          ia_pausada_em: null,
          // Give the bot a fresh reply budget on this thread.
          //
          // ⚠️ Isto JÁ NÃO é exclusivo de gente. Até a migration 936 o
          // comentário aqui dizia que zerar o contador era "deliberadamente
          // não-automatizável" — a lentidão humana era o que impedia o teto
          // por conversa de ser furado em escala. O passo `set_ai` das
          // automações passou a fazer o mesmo, por decisão do operador (D10).
          //
          // Quem for mexer no teto precisa saber: ele agora depende de quem
          // monta a automação. "A cada mensagem recebida, religar a IA" fura o
          // teto para sempre, e o robô responde sem limite naquela conversa.
          ai_reply_count: 0,
          ai_handoff_summary: null,
        }
    // Só no PAUSAR, e só a pedido. Retomar nunca menciona a coluna (ver o
    // cabeçalho).
    if (paused && assignToMe) update.assigned_agent_id = userId

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
