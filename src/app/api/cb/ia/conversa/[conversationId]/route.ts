import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { quemResponde, type AgenteDaEtapa, type CardDoContato } from '@/lib/ia-agentes/quem-responde'

type Contexto = { params: Promise<{ conversationId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LinhaDoCard = { id: string; stage_id: string; pipeline_id: string; etapa_desde: string | null }
type LinhaDaEtapa = { ia_agente_id: string; desde: string | null }
type LinhaDoAgente = {
  id: string
  nome: string
  ativo: boolean | null
  arquivado_em: string | null
  conexoes: unknown
  ativado_em: string | null
}

/**
 * GET /api/cb/ia/conversa/[conversationId]  (qualquer membro)
 *
 * O que a faixa do fio precisa saber (D24–D27):
 * `{ agente: { id, nome } | null, pausada, pausadaPor, motivo }`.
 *   - `agente` — o agente da ETAPA do card aberto mais recente do contato que
 *     ATENDERIA esta conversa (ligado, com a conexão da conversa, e o card
 *     entrou na etapa depois — D27), MESMO com a IA pausada (a faixa diz "IA
 *     pausada" e oferece Retomar); nulo = ninguém.
 *   - `pausada`/`pausadaPor` — a pausa e o motivo (`gente`, `botao`,
 *     `transferencia`, `automacao`; nulo = pausa sem motivo).
 *   - `motivo` — por que `agente` é nulo (o `MotivoDeNinguem` do motor).
 *
 * A regra é a do MOTOR (`quemResponde`), com os fatos da CONVERSA — a
 * conexão da ÚLTIMA mensagem do cliente (o motor decide pela conexão da
 * mensagem; a da conversa pode estar FIXADA noutro número — Codex, #309),
 * senão a da conversa; a situação dela; e o que depende da mensagem (robô,
 * automação, conteúdo) e a pausa neutros: a faixa responde "quem atende
 * aqui", não "quem responderia esta mensagem". Cliente de SERVIÇO com a conta
 * da sessão em toda consulta: o agente só dá SELECT ao administrador, e daqui
 * sai só o nome.
 */
export async function GET(_request: Request, { params }: Contexto) {
  try {
    const ctx = await getCurrentAccount()
    const { conversationId } = await params
    const naoEncontrada = () =>
      NextResponse.json({ error: 'nao_encontrada', code: 'nao_encontrada' }, { status: 404 })
    if (!UUID.test(conversationId)) return naoEncontrada()
    const db = supabaseAdmin()
    const falhou = (onde: string, mensagem: string) => {
      console.error(`[cb/ia/conversa] ${onde}:`, mensagem)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }

    const { data: conv, error: erroConv } = await db
      .from('conversations')
      .select('id, status, contact_id, group_id, channel_id, ai_autoreply_disabled, ia_pausada_por')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (erroConv) return falhou('conversa', erroConv.message)
    if (!conv) return naoEncontrada()
    const pausada = conv.ai_autoreply_disabled === true
    const pausadaPor = pausada && typeof conv.ia_pausada_por === 'string' ? conv.ia_pausada_por : null
    const ehGrupo = Boolean(conv.group_id)
    const { data: ultima, error: erroUltima } = await db
      .from('messages')
      .select('channel_id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .not('channel_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (erroUltima) return falhou('última mensagem', erroUltima.message)
    const canalDaUltima = (ultima as { channel_id?: unknown } | null)?.channel_id
    const canalId =
      typeof canalDaUltima === 'string' ? canalDaUltima : typeof conv.channel_id === 'string' ? conv.channel_id : null

    let instagram = false
    if (canalId) {
      const { data, error } = await db
        .from('cb_channels')
        .select('kind')
        .eq('id', canalId)
        .eq('account_id', ctx.accountId)
        .maybeSingle()
      if (error) return falhou('conexão', error.message)
      instagram = data ? ehInstagram(data as { kind: string }) : false
    }

    // O card: o negócio ABERTO mais recente do contato; a etapa dele; o agente.
    let card: CardDoContato | null = null
    let agente: (AgenteDaEtapa & { nome: string }) | null = null
    if (!ehGrupo && !instagram && conv.contact_id) {
      const { data: deal, error: erroDeal } = await db
        .from('deals')
        .select('id, stage_id, pipeline_id, etapa_desde')
        .eq('account_id', ctx.accountId)
        .eq('contact_id', conv.contact_id)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (erroDeal) return falhou('card', erroDeal.message)
      const d = deal as LinhaDoCard | null
      if (d) card = { id: d.id, stageId: d.stage_id, pipelineId: d.pipeline_id, etapaDesde: d.etapa_desde }
    }
    if (card) {
      const { data: etapa, error: erroEtapa } = await db
        .from('cb_ia_agente_etapas')
        .select('ia_agente_id, desde')
        .eq('account_id', ctx.accountId)
        .eq('stage_id', card.stageId)
        .maybeSingle()
      if (erroEtapa) return falhou('etapa', erroEtapa.message)
      const e = etapa as LinhaDaEtapa | null
      if (e) {
        const { data: ag, error: erroAgente } = await db
          .from('cb_ia_agentes')
          .select('id, nome, ativo, arquivado_em, conexoes, ativado_em')
          .eq('account_id', ctx.accountId)
          .eq('id', e.ia_agente_id)
          .maybeSingle()
        if (erroAgente) return falhou('agente', erroAgente.message)
        const a = ag as LinhaDoAgente | null
        if (a) {
          agente = {
            id: a.id,
            nome: a.nome,
            ativo: a.ativo === true,
            arquivado: a.arquivado_em !== null,
            conexoes: Array.isArray(a.conexoes) ? a.conexoes.filter((x): x is string => typeof x === 'string') : [],
            ativadoEm: a.ativado_em,
            desde: e.desde,
          }
        }
      }
    }

    const decisao = quemResponde({
      ehGrupo,
      ehInstagram: instagram,
      canalId,
      // Os fatos da MENSAGEM vão neutros (uma mensagem de texto que ninguém
      // consumiu), e a pausa também: ela sai à parte, em `pausada`.
      conteudo: { tipo: 'text', texto: '.', mime: null },
      ehRespostaDeBotao: false,
      roboConsumiu: false,
      automacaoFalou: false,
      encerrada: conv.status === 'closed',
      pausada: false,
      card,
      agente,
    })
    return NextResponse.json({
      agente: decisao.quem === 'agente' && agente ? { id: agente.id, nome: agente.nome } : null,
      pausada,
      pausadaPor,
      motivo: decisao.quem === 'ninguem' ? decisao.motivo : null,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
