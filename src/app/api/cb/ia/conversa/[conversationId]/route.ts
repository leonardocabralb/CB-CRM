import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import {
  canalDaIaNaConversa,
  ehNumeroDeConexao,
  lerCardEAgente,
  MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE,
  quemResponde,
  type AgenteDaEtapaComNome,
  type CardDoContato,
  type MotivoDoAgenteQueNaoAtende,
} from '@/lib/ia-agentes/quem-responde'

type Contexto = { params: Promise<{ conversationId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/cb/ia/conversa/[conversationId]  (qualquer membro)
 *
 * O que a faixa do fio precisa saber (D24–D27):
 * `{ agente: { id, nome } | null, pausada, pausadaPor, motivo, naoAtende }`.
 *   - `agente` — o agente da ETAPA do card que decide (`lerCardEAgente`: o
 *     aberto mais recente cujo agente atende esta conexão, senão o mais
 *     recente) que ATENDERIA esta conversa (ligado, com a conexão da conversa,
 *     e o card entrou na etapa depois — D27), MESMO com a IA pausada (a faixa diz "IA
 *     pausada" e oferece Retomar); nulo = ninguém.
 *   - `pausada`/`pausadaPor` — a pausa e o motivo (`gente`, `botao`,
 *     `transferencia`, `automacao`; nulo = pausa sem motivo).
 *   - `motivo` — por que `agente` é nulo (o `MotivoDeNinguem` do motor).
 *   - `naoAtende` — `{ agente: { id, nome }, motivo }` quando a etapa do card
 *     TEM agente, mas ele não atende esta conversa (desligado, sem a conexão,
 *     card antigo — `MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE`); nulo nos outros
 *     casos. Sem isso, o card que já estava na etapa quando o agente foi
 *     religado (D27) ficava em silêncio sem rastro nenhum na conversa
 *     (medido, validação de 25/10/2026).
 *
 * Do agente sai SÓ id e nome, nos dois campos: a rota é de qualquer membro,
 * e a configuração (conexões, datas, instruções) é do administrador (D14).
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
    let canalId: string | null
    try {
      canalId = await canalDaIaNaConversa(
        db,
        conversationId,
        typeof conv.channel_id === 'string' ? conv.channel_id : null,
      )
    } catch (err) {
      return falhou('última mensagem', err instanceof Error ? err.message : String(err))
    }

    // As conexões da conta: o tipo da desta conversa e os números (o "cliente"
    // que é outra conexão da conta não tem IA — `ehNumeroDeConexao`).
    const { data: canais, error: erroCanais } = await db
      .from('cb_channels')
      .select('id, kind, display_phone')
      .eq('account_id', ctx.accountId)
    if (erroCanais) return falhou('conexão', erroCanais.message)
    const conexoes = (canais ?? []) as Array<{ id: string; kind: string; display_phone?: unknown }>
    const canal = canalId ? conexoes.find((c) => c.id === canalId) : undefined
    const instagram = canal ? ehInstagram(canal) : false

    // O card e o agente: a MESMA escolha do motor (`lerCardEAgente`).
    let card: CardDoContato | null = null
    let agente: AgenteDaEtapaComNome | null = null
    let conexaoDaConta = false
    if (!ehGrupo && !instagram && conv.contact_id) {
      const { data: contato, error: erroContato } = await db
        .from('contacts')
        .select('phone')
        .eq('account_id', ctx.accountId)
        .eq('id', conv.contact_id)
        .maybeSingle()
      if (erroContato) return falhou('contato', erroContato.message)
      conexaoDaConta = ehNumeroDeConexao((contato as { phone?: unknown } | null)?.phone, conexoes)
      if (!conexaoDaConta) {
        try {
          ;({ card, agente } = await lerCardEAgente(db, { accountId: ctx.accountId, contactId: conv.contact_id, canalId }))
        } catch (err) {
          return falhou('card', err instanceof Error ? err.message : String(err))
        }
      }
    }

    const decisao = quemResponde({
      ehGrupo,
      ehInstagram: instagram,
      ehConexaoDaConta: conexaoDaConta,
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
    const motivo = decisao.quem === 'ninguem' ? decisao.motivo : null
    const naoAtende =
      agente && motivo && (MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE as readonly string[]).includes(motivo)
        ? { agente: { id: agente.id, nome: agente.nome }, motivo: motivo as MotivoDoAgenteQueNaoAtende }
        : null
    return NextResponse.json({
      agente: decisao.quem === 'agente' && agente ? { id: agente.id, nome: agente.nome } : null,
      pausada,
      pausadaPor,
      motivo,
      naoAtende,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
