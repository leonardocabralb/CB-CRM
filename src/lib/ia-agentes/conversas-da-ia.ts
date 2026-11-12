// ============================================================
// As conversas da IA, em LOTE, para os dois filtros da caixa de entrada
// (pedido do operador, 12/11/2026):
//
//  - ATENDIMENTO DA IA: um agente LIGADO é dono do atendimento agora — ele
//    responderia a próxima mensagem do cliente (a MESMA regra do motor,
//    `quemResponde`, com os fatos da mensagem neutros, como a faixa do fio),
//    inclusive por cima da pausa TEMPORÁRIA (a equipe falou e a IA volta
//    sozinha, 1138: é o follow-up), OU há turno dela na fila ou rodando
//    (resposta ou retomada). A pausa PERMANENTE (transferência, "Desativar
//    IA", automação) tira daqui.
//  - PENDÊNCIAS DA IA: a IA passou a conversa para a equipe (pausa
//    `transferencia`). Sai quando alguém encerra (a aba), aperta "Retomar IA"
//    (a pausa some) ou TIRA o card de onde a IA o deixou — o card do turno que
//    transferiu mudou de etapa depois da transferência, foi ganho/perdido ou
//    apagado (no Trabalhista e no Prev, a pendência move o card para
//    "Pendências da IA"; mover de lá é "resolvi").
//
// ⚠️ O que decide é o motor: `quemResponde` e a escolha do card de
// `lerCardEAgente` (o aberto mais recente cujo agente ligado atende a conexão;
// sem nenhum, o mais recente). Cópia da regra divergiria da faixa do fio.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ehInstagram } from '@/lib/cb-channels/transporte'
import { ehMotivoTemporario, lerVoltaAposMin } from '@/lib/ia-agentes/pausa'
import {
  canalDaIaNaConversa,
  ehNumeroDeConexao,
  quemResponde,
  type AgenteDaEtapa,
  type CardDoContato,
} from '@/lib/ia-agentes/quem-responde'

/**
 * Folga entre os dois relógios (o card mexido é carimbado pelo BANCO; a
 * transferência, pelo servidor do app): a IA move o card para "Pendências"
 * e transfere no MESMO turno, segundos antes. Card mexido até 2 min depois da
 * transferência conta como o movimento da própria IA.
 */
export const FOLGA_DO_CARD_MOVIDO_MS = 2 * 60_000

/** Quantos cards abertos do contato a escolha olha — o de `lerCardEAgente`. */
const CARDS_ABERTOS_LIDOS = 20

/** Página das leituras em lote (o PostgREST corta em 1000 sem avisar). */
const PAGINA = 1000
/** Tamanho dos `.in(...)` (a URL do PostgREST tem teto). */
const LOTE_DO_IN = 150

// ------------------------------------------------------------
// A parte pura
// ------------------------------------------------------------

export interface ConversaCandidata {
  id: string
  contactId: string | null
  ehGrupo: boolean
  /** A conexão em que a IA decide (a da última mensagem do cliente, senão a da conversa). */
  canalId: string | null
  encerrada: boolean
  pausada: boolean
  pausadaPor: string | null
  pausadaEm: string | null
}

export interface CardAberto extends CardDoContato {
  contactId: string
}

/** O card do turno que transferiu, como está AGORA (nulo = apagado). */
export interface CardDaTransferencia {
  status: string
  etapaDesde: string | null
}

export interface FatosDasConversas {
  conversas: readonly ConversaCandidata[]
  /** O N da conta (1138): 0 = a pausa temporária segura como a permanente. */
  voltaAposMin: number
  /** Conexões da conta que são do Instagram (o agente não atende no Direct). */
  canaisDoInstagram: ReadonlySet<string>
  /** Contatos que são o número de OUTRA conexão da conta. */
  contatosQueSaoConexao: ReadonlySet<string>
  /** Cards ABERTOS por contato, do mais recente ao mais antigo (`created_at` DESC, `id` DESC). */
  cardsPorContato: ReadonlyMap<string, readonly CardAberto[]>
  /** `stage_id` → o agente da etapa (com o `desde` da etapa). */
  agentePorEtapa: ReadonlyMap<string, AgenteDaEtapa>
  /** Conversas com turno `aguardando` ou `rodando`. */
  comTurnoVivo: ReadonlySet<string>
  /** conversa transferida → o card do turno que transferiu (ausente = nenhum turno com card). */
  cardDaTransferencia: ReadonlyMap<string, CardDaTransferencia | null>
}

export interface ConversasDaIa {
  atendimento: Set<string>
  pendencias: Set<string>
}

function instante(iso: string | null | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** A escolha de `lerCardEAgente`, sobre os cards já lidos. */
export function escolherCard(
  cards: readonly CardAberto[],
  agentePorEtapa: ReadonlyMap<string, AgenteDaEtapa>,
  canalId: string | null,
): { card: CardDoContato | null; agente: AgenteDaEtapa | null } {
  const primeiros = cards.slice(0, CARDS_ABERTOS_LIDOS)
  if (primeiros.length === 0) return { card: null, agente: null }
  const atende = (a: AgenteDaEtapa | undefined) =>
    !!a && a.ativo && !a.arquivado && canalId !== null && a.conexoes.includes(canalId)
  const escolhido = primeiros.find((c) => atende(agentePorEtapa.get(c.stageId))) ?? primeiros[0]
  const card: CardDoContato = { id: escolhido.id, stageId: escolhido.stageId, pipelineId: escolhido.pipelineId, etapaDesde: escolhido.etapaDesde }
  return { card, agente: agentePorEtapa.get(escolhido.stageId) ?? null }
}

/** A pendência ainda está de pé? (a conversa já é transferida e não encerrada) */
export function pendenciaDePe(pausadaEm: string | null, card: CardDaTransferencia | null | undefined): boolean {
  // Nenhum turno com card (não deveria acontecer: só o turno transfere) = de pé.
  if (card === undefined) return true
  // O card foi apagado: saiu do funil.
  if (card === null) return false
  if (card.status !== 'open') return false
  const transferiu = instante(pausadaEm)
  const mexido = instante(card.etapaDesde)
  if (transferiu === null || mexido === null) return true
  return mexido <= transferiu + FOLGA_DO_CARD_MOVIDO_MS
}

export function classificarConversasDaIa(f: FatosDasConversas): ConversasDaIa {
  const atendimento = new Set<string>()
  const pendencias = new Set<string>()
  for (const c of f.conversas) {
    if (c.encerrada) continue
    const temporaria = c.pausada && ehMotivoTemporario(c.pausadaPor)
    const permanente = c.pausada && !temporaria
    if (permanente) {
      if (c.pausadaPor === 'transferencia' && pendenciaDePe(c.pausadaEm, f.cardDaTransferencia.get(c.id))) {
        pendencias.add(c.id)
      }
      continue
    }
    // Com N = 0 na conta a pausa temporária SEGURA (até o "Retomar IA").
    if (temporaria && f.voltaAposMin <= 0) continue
    if (f.comTurnoVivo.has(c.id)) {
      atendimento.add(c.id)
      continue
    }
    if (c.ehGrupo || !c.contactId) continue
    const { card, agente } = escolherCard(f.cardsPorContato.get(c.contactId) ?? [], f.agentePorEtapa, c.canalId)
    const decisao = quemResponde({
      ehGrupo: c.ehGrupo,
      ehInstagram: c.canalId !== null && f.canaisDoInstagram.has(c.canalId),
      ehConexaoDaConta: f.contatosQueSaoConexao.has(c.contactId),
      canalId: c.canalId,
      // Os fatos da MENSAGEM vão neutros, como na faixa do fio: "quem atende
      // aqui", não "quem responderia esta mensagem".
      conteudo: { tipo: 'text', texto: '.', mime: null },
      ehRespostaDeBotao: false,
      roboConsumiu: false,
      automacaoFalou: false,
      encerrada: false,
      pausada: c.pausada,
      pausaTemporaria: temporaria,
      card,
      agente,
    })
    if (decisao.quem === 'agente') atendimento.add(c.id)
  }
  return { atendimento, pendencias }
}

// ------------------------------------------------------------
// A leitura (cliente de SERVIÇO, a conta em toda consulta). LANÇA em erro.
// ------------------------------------------------------------

function emLotes<T>(itens: readonly T[], tamanho = LOTE_DO_IN): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}

type LinhaDaConversa = {
  id: string
  contact_id: string | null
  group_id: string | null
  channel_id: string | null
  channel_pinned: boolean | null
  status: string
  ai_autoreply_disabled: boolean | null
  ia_pausada_por: string | null
  ia_pausada_em: string | null
}

export async function lerConversasDaIa(db: SupabaseClient, accountId: string): Promise<ConversasDaIa> {
  const falha = (onde: string, mensagem: string) => new Error(`[conversas-da-ia] ${onde}: ${mensagem}`)

  // As conversas ATIVAS (abertas e pendentes), por CHAVE.
  const linhas: LinhaDaConversa[] = []
  let depoisDe: string | null = null
  for (;;) {
    let q = db
      .from('conversations')
      .select('id, contact_id, group_id, channel_id, channel_pinned, status, ai_autoreply_disabled, ia_pausada_por, ia_pausada_em')
      .eq('account_id', accountId)
      .neq('status', 'closed')
      .order('id', { ascending: true })
      .limit(PAGINA)
    if (depoisDe) q = q.gt('id', depoisDe)
    const { data, error } = await q
    if (error) throw falha('conversas', error.message)
    const pagina = (data ?? []) as LinhaDaConversa[]
    linhas.push(...pagina)
    if (pagina.length < PAGINA) break
    depoisDe = pagina[pagina.length - 1].id
  }

  const [{ data: canais, error: erroCanais }, { data: agentes, error: erroAgentes }, { data: etapas, error: erroEtapas }] =
    await Promise.all([
      db.from('cb_channels').select('id, kind, display_phone').eq('account_id', accountId),
      db.from('cb_ia_agentes').select('id, ativo, arquivado_em, conexoes, ativado_em').eq('account_id', accountId),
      db.from('cb_ia_agente_etapas').select('stage_id, ia_agente_id, desde').eq('account_id', accountId),
    ])
  if (erroCanais) throw falha('conexões', erroCanais.message)
  if (erroAgentes) throw falha('agentes', erroAgentes.message)
  if (erroEtapas) throw falha('etapas dos agentes', erroEtapas.message)
  const conexoes = (canais ?? []) as Array<{ id: string; kind: string; display_phone?: unknown }>
  const canaisDoInstagram = new Set(conexoes.filter((c) => ehInstagram(c)).map((c) => c.id))

  const agentePorId = new Map(
    ((agentes ?? []) as Array<{ id: string; ativo: boolean | null; arquivado_em: string | null; conexoes: unknown; ativado_em: string | null }>).map(
      (a) => [
        a.id,
        {
          id: a.id,
          ativo: a.ativo === true,
          arquivado: a.arquivado_em !== null,
          conexoes: Array.isArray(a.conexoes) ? a.conexoes.filter((x): x is string => typeof x === 'string') : [],
          ativadoEm: a.ativado_em,
        },
      ],
    ),
  )
  const agentePorEtapa = new Map<string, AgenteDaEtapa>()
  for (const e of (etapas ?? []) as Array<{ stage_id: string; ia_agente_id: string; desde: string | null }>) {
    const a = agentePorId.get(e.ia_agente_id)
    if (a) agentePorEtapa.set(e.stage_id, { ...a, desde: e.desde })
  }

  // Os turnos vivos da conta (poucos: um pendente por conversa e conexão).
  const comTurnoVivo = new Set<string>()
  {
    const { data, error } = await db
      .from('cb_ia_turnos')
      .select('conversation_id')
      .eq('account_id', accountId)
      .in('status', ['aguardando', 'rodando'])
      .limit(PAGINA)
    if (error) throw falha('turnos', error.message)
    for (const t of (data ?? []) as Array<{ conversation_id: string | null }>) {
      if (t.conversation_id) comTurnoVivo.add(t.conversation_id)
    }
    if ((data ?? []).length >= PAGINA) throw falha('turnos', 'turnos vivos demais')
  }

  // Só quem pode ser da IA precisa de contato e card: sem pausa permanente e
  // com contato. Sem agente ligado em etapa nenhuma, ninguém atende.
  const algumAgenteLigado = [...agentePorEtapa.values()].some((a) => a.ativo && !a.arquivado)
  const candidatas = linhas.filter(
    (c) =>
      algumAgenteLigado &&
      c.contact_id !== null &&
      c.group_id === null &&
      !(c.ai_autoreply_disabled === true && !ehMotivoTemporario(c.ia_pausada_por)),
  )
  const contatos = [...new Set(candidatas.map((c) => c.contact_id as string))]

  const contatosQueSaoConexao = new Set<string>()
  const cardsPorContato = new Map<string, CardAberto[]>()
  for (const lote of emLotes(contatos)) {
    const [{ data: fichas, error: erroFichas }, { data: deals, error: erroDeals }] = await Promise.all([
      db.from('contacts').select('id, phone').eq('account_id', accountId).in('id', lote),
      db
        .from('deals')
        .select('id, contact_id, stage_id, pipeline_id, etapa_desde')
        .eq('account_id', accountId)
        .eq('status', 'open')
        .in('contact_id', lote)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGINA),
    ])
    if (erroFichas) throw falha('contatos', erroFichas.message)
    if (erroDeals) throw falha('cards', erroDeals.message)
    for (const f of (fichas ?? []) as Array<{ id: string; phone?: unknown }>) {
      if (ehNumeroDeConexao(f.phone, conexoes)) contatosQueSaoConexao.add(f.id)
    }
    const cards = (deals ?? []) as Array<{ id: string; contact_id: string; stage_id: string; pipeline_id: string; etapa_desde: string | null }>
    if (cards.length >= PAGINA) throw falha('cards', 'lote com cards demais')
    for (const d of cards) {
      const lista = cardsPorContato.get(d.contact_id) ?? []
      lista.push({ id: d.id, contactId: d.contact_id, stageId: d.stage_id, pipelineId: d.pipeline_id, etapaDesde: d.etapa_desde })
      cardsPorContato.set(d.contact_id, lista)
    }
  }

  // A conexão em que a IA decide é a da FAIXA do fio (`canalDaIaNaConversa`:
  // a última mensagem do cliente que abre turno, senão a da conversa) — o
  // `channel_id` segue também figurinha e toque em botão, e o "Automático"
  // deixa o antigo. Custa uma ida ao banco por conversa, então só onde ela
  // pode mudar a resposta: o contato tem card numa etapa com agente LIGADO
  // que passa na D27. Sem nenhum, a resposta é "ninguém" em QUALQUER
  // conexão (o card escolhido falha a D27, ou o agente dele não atende).
  // Medido em 12/11/2026: as 57 fixadas em série custavam 5,8 s.
  const canalPorConversa = new Map<string, string | null>()
  for (const c of linhas) canalPorConversa.set(c.id, c.channel_id)
  const cardQuePodeSerAtendido = (d: CardAberto) => {
    const a = agentePorEtapa.get(d.stageId)
    if (!a || !a.ativo || a.arquivado) return false
    const entrou = instante(d.etapaDesde)
    const desde = instante(a.desde)
    const ligado = instante(a.ativadoEm)
    return entrou !== null && desde !== null && ligado !== null && entrou >= Math.max(desde, ligado)
  }
  const aResolver = candidatas.filter((c) =>
    (cardsPorContato.get(c.contact_id as string) ?? []).some(cardQuePodeSerAtendido),
  )
  for (const c of aResolver) {
    canalPorConversa.set(c.id, await canalDaIaNaConversa(db, c.id, c.channel_id))
  }

  // As transferidas: o card do ÚLTIMO turno com card de cada uma, até a pausa.
  // Uma leitura de UMA linha por transferida (as linhas de `cb_ia_turnos`
  // ficam: o histórico de uma conversa longa estouraria qualquer teto).
  const transferidas = linhas.filter((c) => c.ai_autoreply_disabled === true && c.ia_pausada_por === 'transferencia')
  const cardDaTransferencia = new Map<string, CardDaTransferencia | null>()
  for (const c of transferidas) {
    let q = db
      .from('cb_ia_turnos')
      .select('deal_id')
      .eq('account_id', accountId)
      .eq('conversation_id', c.id)
      .not('deal_id', 'is', null)
    if (c.ia_pausada_em) q = q.lte('created_at', c.ia_pausada_em)
    const { data: turnos, error } = await q.order('created_at', { ascending: false }).limit(1)
    if (error) throw falha('turno da transferida', error.message)
    const dealId = ((turnos ?? [])[0] as { deal_id?: unknown } | undefined)?.deal_id
    if (typeof dealId !== 'string') continue
    const { data: deal, error: erroDeal } = await db
      .from('deals')
      .select('status, etapa_desde')
      .eq('account_id', accountId)
      .eq('id', dealId)
      .maybeSingle()
    if (erroDeal) throw falha('card da transferida', erroDeal.message)
    const d = deal as { status: string; etapa_desde: string | null } | null
    cardDaTransferencia.set(c.id, d ? { status: d.status, etapaDesde: d.etapa_desde } : null)
  }

  const conversas: ConversaCandidata[] = linhas.map((c) => {
    const pausada = c.ai_autoreply_disabled === true
    return {
      id: c.id,
      contactId: c.contact_id,
      ehGrupo: c.group_id !== null,
      canalId: canalPorConversa.get(c.id) ?? null,
      encerrada: c.status === 'closed',
      pausada,
      pausadaPor: pausada ? c.ia_pausada_por : null,
      pausadaEm: pausada ? c.ia_pausada_em : null,
    }
  })

  // Com agente ligado ou turno vivo, o N da conta decide a pausa temporária.
  const voltaAposMin = algumAgenteLigado || comTurnoVivo.size > 0 ? await lerVoltaAposMin(db, accountId) : 0

  return classificarConversasDaIa({
    conversas,
    voltaAposMin,
    canaisDoInstagram,
    contatosQueSaoConexao,
    cardsPorContato,
    agentePorEtapa,
    comTurnoVivo,
    cardDaTransferencia,
  })
}
