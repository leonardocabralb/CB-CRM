import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/ai/admin-client'
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { ehInstagram } from '@/lib/cb-channels/transporte'
import { ehMotivoTemporario, ERRO_DA_ESPERA_DA_EQUIPE, lerVoltaAposMin } from '@/lib/ia-agentes/pausa'
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
import {
  COLUNAS_DO_PROXIMO_PASSO,
  proximoPassoDaIa,
  type ProximoPasso,
  type TurnoVivo,
} from '@/lib/ia-agentes/proximo-passo'

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
 *     `desativada`, `transferencia`, `automacao`; nulo = pausa sem motivo).
 *   - `voltaAposMin` — o N da CONTA (1138): em quantos minutos sem resposta
 *     da equipe a IA volta; 0 = desligado (toda pausa até o "Retomar IA").
 *   - `pausaTemporaria` — a pausa VOLTA sozinha (`gente`/`botao` com N > 0).
 *   - `voltaEm` — quando o turno que espera a equipe vai rodar (o pendente
 *     marcado `ERRO_DA_ESPERA_DA_EQUIPE`); nulo = nenhuma mensagem esperando.
 *   - `proximo` — o PRÓXIMO PASSO da IA (pedido do operador, 12/11/2026):
 *     escrevendo agora, a resposta na fila ou o follow-up agendado
 *     (`proximoPassoDaIa`); nulo = nada na fila. Só com agente atendendo e a
 *     IA ativa ou na pausa que volta sozinha.
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

    // A pausa temporária (1138): o N da conta, e quando a IA volta — o
    // pendente que espera a equipe. Só onde há agente ou pausa (a faixa só
    // aparece aí). Leitura que falha é 500, como as outras: nunca "0 = como
    // antes" nem "não volta" por ignorância.
    let voltaAposMin = 0
    let voltaEm: string | null = null
    if (decisao.quem === 'agente' || pausada) {
      try {
        voltaAposMin = await lerVoltaAposMin(db, ctx.accountId)
      } catch (err) {
        return falhou('pausa da conta', err instanceof Error ? err.message : String(err))
      }
    }
    // A temporária só VOLTA onde um agente atenderia (o card numa etapa com
    // agente ligado, com a conexão, D27): no card que saiu para etapa sem
    // agente, ou com o agente desligado, nenhum turno nasce — "volta sozinha"
    // seria falso.
    const pausaTemporaria =
      pausada && voltaAposMin > 0 && ehMotivoTemporario(pausadaPor) && decisao.quem === 'agente'
    if (pausaTemporaria) {
      const { data: espera, error: erroEspera } = await db
        .from('cb_ia_turnos')
        .select('executar_apos')
        .eq('account_id', ctx.accountId)
        .eq('conversation_id', conversationId)
        .eq('status', 'aguardando')
        .eq('tipo', 'resposta')
        .eq('erro', ERRO_DA_ESPERA_DA_EQUIPE)
        .order('executar_apos', { ascending: true })
        .limit(1)
      if (erroEspera) return falhou('espera da equipe', erroEspera.message)
      const primeira = (espera ?? [])[0] as { executar_apos?: unknown } | undefined
      voltaEm = typeof primeira?.executar_apos === 'string' ? primeira.executar_apos : null
    }
    // O próximo passo: só onde um agente atende, com a IA ativa ou na pausa
    // que volta sozinha — na permanente nenhum turno sai, e o follow-up
    // armado seria descartado no vencimento. O follow-up só atravessa a
    // pausa `gente` (`ia-retomada.md`).
    let proximo: ProximoPasso | null = null
    if (decisao.quem === 'agente' && (!pausada || pausaTemporaria)) {
      const { data: vivos, error: erroVivos } = await db
        .from('cb_ia_turnos')
        .select(COLUNAS_DO_PROXIMO_PASSO)
        .eq('account_id', ctx.accountId)
        .eq('conversation_id', conversationId)
        .in('status', ['aguardando', 'rodando'])
        .order('executar_apos', { ascending: true })
        .limit(10)
      if (erroVivos) return falhou('próximo passo', erroVivos.message)
      proximo = proximoPassoDaIa((vivos ?? []) as TurnoVivo[], {
        atravessaRetomada: !pausada || pausadaPor === 'gente',
        // O dono de agora: o turno de outro (card movido para a etapa de
        // outro agente) é descartado pela conferência do motor.
        dono: { agenteId: decisao.agenteId, dealId: decisao.dealId, stageId: decisao.stageId },
      })
    }
    return NextResponse.json({
      agente: decisao.quem === 'agente' && agente ? { id: agente.id, nome: agente.nome } : null,
      pausada,
      pausadaPor,
      pausaTemporaria,
      voltaAposMin,
      voltaEm,
      proximo,
      motivo,
      naoAtende,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
