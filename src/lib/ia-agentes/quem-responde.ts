// ============================================================
// QUEM RESPONDE a mensagem do cliente (docs/PLANO-agentes-de-ia.md, D24–D27).
// A regra (`quemResponde`) é PURA, testada; `lerQuemAtende` lê os fatos dela
// do banco (o cliente vem por parâmetro) — a MESMA leitura na entrada
// (`entrada.ts`) e nas conferências do turno (`turno.ts`).
//
// O agente atua por ETAPA do funil (D24): o card ABERTO mais recente do
// contato está numa etapa com agente (`cb_ia_agente_etapas`, no máximo um
// por etapa) → esse agente responde, se ligado, não arquivado, dono da
// conexão da mensagem, e se o card ENTROU na etapa depois de o agente ser
// ligado nela (D27: `etapa_desde >= greatest(desde, ativado_em)` — o lead
// antigo parado na etapa não é atendido).
//
// A ordem das regras É a regra:
//   0. fora do alcance (grupo, Instagram, sem conexão) e mensagem que não
//      abre turno (`abreTurno`, e o toque em botão) → ninguém;
//   1. o robô consumiu a mensagem → ninguém;
//   2. uma automação desta mensagem FALOU (ou vai falar) com o contato
//      (`ResultadoDoDisparo.falou`, E4) → ninguém;
//   3. conversa encerrada, ou pausada (D26: gente respondeu, o botão, a
//      transferência, uma automação) → ninguém — MENOS a pausa TEMPORÁRIA que
//      quem chama declara (`pausaTemporaria`, 1138: `gente`/`botao` com N > 0
//      na conta, `pausa.ts`): aí as regras seguem, e o agente que atende vem
//      marcado `sobrePausa` (o turno espera a equipe e levanta a pausa);
//   4. sem card aberto, etapa sem agente, agente desligado ou arquivado,
//      agente sem a conexão, card anterior ao agente (D27) → ninguém;
//   5. senão → o agente da etapa, com o card e a etapa (o turno confere que
//      continuam os mesmos até o envio).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ehInstagram } from '@/lib/cb-channels/transporte'
import { chaveDePessoa } from '@/lib/contacts/dedupe'

import { ehMotivoTemporario } from './pausa'

/** Tipos de mensagem que abrem turno (E9). Localização e toque em botão (`interactive`) não. */
export const TIPOS_QUE_ABREM_TURNO: ReadonlySet<string> = new Set(['text', 'audio', 'image', 'document', 'video'])

/**
 * O MIME da figurinha do WhatsApp (sempre WebP, estática ou animada). ⚠️ As
 * DUAS ingestões gravam a figurinha como `content_type = 'image'` (o CHECK de
 * `messages` não tem `sticker`): o que a separa de uma foto na LINHA é o
 * `media_type`. A Meta o grava no próprio insert (`sticker.mime_type`); a
 * Evolution só o grava no download, depois — por isso `persistInboundMessage`
 * o grava já no insert quando o payload é `stickerMessage`.
 */
export const MIME_DA_FIGURINHA = 'image/webp'

/**
 * A linha é uma FIGURINHA? UMA régua para as três pontas: quem abre turno
 * (`abreTurno`), quem o turno lê (`prepararMidias` — figurinha não se lê) e
 * como o agente a vê (`contexto.ts`: `[sticker]`, nunca uma foto não lida).
 */
export function ehFigurinha(tipo: string, mime: string | null | undefined): boolean {
  return tipo === 'image' && mime?.split(';')[0].trim().toLowerCase() === MIME_DA_FIGURINHA
}

/**
 * O começo do texto com que o webhook da META grava o tipo de mensagem que
 * ele não sabe ler — cartão de contato (`contacts`), `system`, `unsupported`,
 * e o que a Meta inventar depois: `content_type = 'text'` e `content_text =
 * "[Unsupported message type: contacts]"`. Não é fala do cliente, é o rótulo
 * que a rota escreve (E9: o cartão de contato não abre turno — na Evolution
 * ele chega com o texto NULO e já não abria). ⚠️ UMA constante para as duas
 * pontas: o webhook MONTA o texto com ela e `abreTurno` a RECUSA. Texto
 * reescrito só num lado volta a abrir turno — e a abrir o turno que DESCARTA
 * o turno em curso (E10), calando a resposta à pergunta de verdade.
 */
export const PREFIXO_DE_TIPO_NAO_SUPORTADO = '[Unsupported message type:'

/** O conteúdo da mensagem COMO FICOU GRAVADO (`content_type`, `content_text`, `media_type`). */
export interface ConteudoDaMensagem {
  tipo: string
  texto: string | null
  mime: string | null
}

/** Algo visível no texto: sem espaço, sem caractere de formatação (`\p{Cf}`) e sem o `\uFFFC` do iOS. */
function temTextoVisivel(texto: string | null): boolean {
  return !!texto && texto.replace(/[\s\p{Cf}\uFFFC]/gu, '') !== ''
}

/**
 * A mensagem ABRE turno? (E9) A MESMA régua na entrada (`entrada.ts`, com o
 * que a ingestão gravou) e no turno (`turno.ts`, lendo a linha): a mensagem
 * mais nova só DESCARTA o turno em curso se abrir o dela (E10). Duas réguas
 * diferentes = o cliente manda texto e figurinha, o turno do texto é
 * descartado pela figurinha, e a figurinha não abre turno — ninguém responde.
 *
 * Não abrem: tipo fora de `TIPOS_QUE_ABREM_TURNO` (localização, botão e,
 * desde a 1060, o cartão de contato, `contact`, e a mensagem montada por
 * sistema de empresa, `template` — um banco avisando do boleto), figurinha, texto sem nada
 * visível e o rótulo do tipo que a ingestão não sabe ler
 * (`PREFIXO_DE_TIPO_NAO_SUPORTADO`), gravado como `text` — pela Meta e, desde
 * a 1060, também pela Evolution (enquete, vídeo redondo, evento…).
 */
export function abreTurno(c: ConteudoDaMensagem): boolean {
  if (!TIPOS_QUE_ABREM_TURNO.has(c.tipo)) return false
  if (ehFigurinha(c.tipo, c.mime)) return false
  if (c.tipo === 'text' && !temTextoVisivel(c.texto)) return false
  if (c.tipo === 'text' && c.texto?.startsWith(PREFIXO_DE_TIPO_NAO_SUPORTADO)) return false
  return true
}

/** O card ABERTO mais recente do contato (`deals`). */
export interface CardDoContato {
  id: string
  stageId: string
  pipelineId: string
  /** `deals.etapa_desde`: quando o card entrou na etapa em que está. */
  etapaDesde: string | null
}

/** O agente dono da etapa do card, com o `desde` da linha de `cb_ia_agente_etapas`. */
export interface AgenteDaEtapa {
  id: string
  ativo: boolean
  arquivado: boolean
  conexoes: readonly string[]
  /** `cb_ia_agentes.ativado_em`: quando foi ligado pela última vez. */
  ativadoEm: string | null
  /** `cb_ia_agente_etapas.desde`: quando a etapa passou a ser dele. */
  desde: string | null
}

export interface FatosDaMensagem {
  ehGrupo: boolean
  /** A conexão é do Instagram (o agente não responde no Direct, D1 do Instagram). */
  ehInstagram: boolean
  /**
   * O "cliente" é o número de OUTRA conexão da própria conta (revisão de
   * 09/11/2026): a mensagem entre dois números da conta entra como de cliente
   * (validação de 25/10/2026), e com agente nas duas pontas eles responderiam
   * um ao outro até o teto. Fora do alcance, como o grupo. Ausente = não é.
   */
  ehConexaoDaConta?: boolean
  /** A conexão que ficou gravada na mensagem (nula = sem IA). */
  canalId: string | null
  /** O conteúdo gravado — a régua de `abreTurno`. */
  conteudo: ConteudoDaMensagem
  /** Toque em botão de modelo (Meta): não abre turno. */
  ehRespostaDeBotao: boolean
  roboConsumiu: boolean
  automacaoFalou: boolean
  /** `conversations.status = 'closed'` (uma automação pode ter encerrado na ingestão). */
  encerrada: boolean
  /** `conversations.ai_autoreply_disabled`. */
  pausada: boolean
  /**
   * A pausa NÃO segura (1138): quem chama já decidiu que ela é temporária e
   * volta (`pausa.ts`). Ausente = a pausa segura, como antes.
   */
  pausaTemporaria?: boolean
  card: CardDoContato | null
  /** O agente da etapa do card (nulo = a etapa não tem agente). */
  agente: AgenteDaEtapa | null
}

export type MotivoDeNinguem =
  | 'fora_do_alcance'
  | 'nao_abre_turno'
  | 'robo'
  | 'automacao_falou'
  | 'encerrada'
  | 'pausada'
  | 'sem_card'
  | 'etapa_sem_agente'
  | 'agente_desligado'
  | 'fora_da_conexao'
  /** D27: o card entrou na etapa ANTES de o agente ser ligado nela. */
  | 'card_antigo'

/**
 * Os motivos em que a etapa do card TEM agente, mas ele não atende esta
 * conversa: desligado (ou arquivado), sem a conexão, card antigo (D27). A
 * faixa do fio diz quem é e por quê (`naoAtende` de `GET
 * /api/cb/ia/conversa/[id]`) — sem ela, o cliente que escreve depois de
 * religar o agente fica sem resposta e a conversa não mostra NADA (medido,
 * validação de 25/10/2026). Os outros motivos não têm agente a nomear.
 */
export const MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE = [
  'agente_desligado',
  'fora_da_conexao',
  'card_antigo',
] as const satisfies readonly MotivoDeNinguem[]
export type MotivoDoAgenteQueNaoAtende = (typeof MOTIVOS_DO_AGENTE_QUE_NAO_ATENDE)[number]

export type QuemResponde =
  | { quem: 'ninguem'; motivo: MotivoDeNinguem }
  /** `sobrePausa`: o agente atende POR CIMA de uma pausa temporária (1138) — o turno espera a equipe. */
  | { quem: 'agente'; agenteId: string; dealId: string; stageId: string; sobrePausa?: true }

function instante(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function quemResponde(f: FatosDaMensagem): QuemResponde {
  if (f.ehGrupo || f.ehInstagram || f.ehConexaoDaConta === true || !f.canalId) {
    return { quem: 'ninguem', motivo: 'fora_do_alcance' }
  }
  if (f.ehRespostaDeBotao || !abreTurno(f.conteudo)) return { quem: 'ninguem', motivo: 'nao_abre_turno' }
  if (f.roboConsumiu) return { quem: 'ninguem', motivo: 'robo' }
  if (f.automacaoFalou) return { quem: 'ninguem', motivo: 'automacao_falou' }
  if (f.encerrada) return { quem: 'ninguem', motivo: 'encerrada' }
  if (f.pausada && f.pausaTemporaria !== true) return { quem: 'ninguem', motivo: 'pausada' }
  if (!f.card) return { quem: 'ninguem', motivo: 'sem_card' }
  if (!f.agente) return { quem: 'ninguem', motivo: 'etapa_sem_agente' }
  if (!f.agente.ativo || f.agente.arquivado) return { quem: 'ninguem', motivo: 'agente_desligado' }
  if (!f.agente.conexoes.includes(f.canalId)) return { quem: 'ninguem', motivo: 'fora_da_conexao' }
  // D27. Sem uma das datas (não deveria acontecer: o banco as grava), NÃO
  // atende — o lado que atende menos gente.
  const entrou = instante(f.card.etapaDesde)
  const desde = instante(f.agente.desde)
  const ligado = instante(f.agente.ativadoEm)
  if (entrou === null || desde === null || ligado === null || entrou < Math.max(desde, ligado)) {
    return { quem: 'ninguem', motivo: 'card_antigo' }
  }
  return {
    quem: 'agente',
    agenteId: f.agente.id,
    dealId: f.card.id,
    stageId: f.card.stageId,
    ...(f.pausada ? { sobrePausa: true as const } : {}),
  }
}

// ------------------------------------------------------------
// A leitura dos fatos (I/O, o cliente por parâmetro)
// ------------------------------------------------------------

/** O que `lerQuemAtende` leu do banco: tudo que `quemResponde` precisa além da mensagem. */
export interface LeituraDaConversa {
  contactId: string | null
  ehGrupo: boolean
  ehInstagram: boolean
  /** O contato é o número de outra conexão da conta (`ehNumeroDeConexao`). */
  ehConexaoDaConta: boolean
  encerrada: boolean
  pausada: boolean
  /** `conversations.ia_pausada_por` (com a pausa; nulo sem ela). */
  pausadaPor: string | null
  /** `conversations.ia_pausada_em`. */
  pausadaEm: string | null
  /** `conversations.aguardando_desde` (972): a 1ª mensagem do cliente sem resposta. */
  aguardandoDesde: string | null
  card: CardDoContato | null
  agente: AgenteDaEtapa | null
}

/**
 * O telefone é o de uma CONEXÃO da conta (`cb_channels.display_phone`)? Pela
 * chave de pessoa (o nono dígito), nunca pela grafia. Telefone ausente = não.
 */
export function ehNumeroDeConexao(
  telefone: unknown,
  conexoes: ReadonlyArray<{ display_phone?: unknown }>,
): boolean {
  if (typeof telefone !== 'string' || !telefone.trim()) return false
  const chave = chaveDePessoa(telefone)
  if (!chave) return false
  return conexoes.some((c) => typeof c.display_phone === 'string' && c.display_phone.trim() !== '' && chaveDePessoa(c.display_phone) === chave)
}

/** Quantos cards ABERTOS do contato a escolha olha (medido em 09/11/2026: 4 contatos com 2 ou mais). */
const CARDS_ABERTOS_LIDOS = 20

/** O agente da etapa como `lerCardEAgente` o devolve: com o nome (a faixa o mostra). */
export type AgenteDaEtapaComNome = AgenteDaEtapa & { nome: string }

/**
 * QUAL card decide o agente (decisão do operador, 09/11/2026): entre os cards
 * ABERTOS do contato, o mais recente cuja etapa tem agente LIGADO, não
 * arquivado e com a conexão da mensagem; sem nenhum, o card aberto mais
 * recente (a regra de antes, D24 — `quemResponde` diz por que ninguém
 * atende). Antes, o mais recente de QUALQUER funil decidia: o card novo no
 * Trabalhista calava o agente do Bancário na conexão do Bancário. Desempate
 * por `id` (dois cards da mesma transação têm o mesmo `created_at`, e a
 * entrada e a conferência do turno não podem escolher cards diferentes).
 *
 * UMA leitura para o motor (`lerQuemAtende`) e para a faixa
 * (`GET /api/cb/ia/conversa/[id]`). `canalId` nulo (conversa sem fala do
 * cliente) = o mais recente. LANÇA em erro de leitura.
 */
export async function lerCardEAgente(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; canalId: string | null },
): Promise<{ card: CardDoContato | null; agente: AgenteDaEtapaComNome | null }> {
  const { data: deals, error: erroDeal } = await db
    .from('deals')
    .select('id, stage_id, pipeline_id, etapa_desde')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CARDS_ABERTOS_LIDOS)
  if (erroDeal) throw new Error(`leitura do card falhou: ${erroDeal.message}`)
  const cards = (deals ?? []) as Array<{ id: string; stage_id: string; pipeline_id: string; etapa_desde: string | null }>
  if (cards.length === 0) return { card: null, agente: null }

  const { data: linhasDaEtapa, error: erroEtapa } = await db
    .from('cb_ia_agente_etapas')
    .select('stage_id, ia_agente_id, desde')
    .eq('account_id', args.accountId)
    .in('stage_id', [...new Set(cards.map((c) => c.stage_id))])
  if (erroEtapa) throw new Error(`leitura da etapa falhou: ${erroEtapa.message}`)
  const donoDaEtapa = new Map(
    ((linhasDaEtapa ?? []) as Array<{ stage_id: string; ia_agente_id: string; desde: string | null }>).map((e) => [e.stage_id, e]),
  )

  const agentes = new Map<string, Omit<AgenteDaEtapaComNome, 'desde'>>()
  const ids = [...new Set([...donoDaEtapa.values()].map((e) => e.ia_agente_id))]
  if (ids.length > 0) {
    const { data: linhas, error: erroAgente } = await db
      .from('cb_ia_agentes')
      .select('id, nome, ativo, arquivado_em, conexoes, ativado_em')
      .eq('account_id', args.accountId)
      .in('id', ids)
    if (erroAgente) throw new Error(`leitura do agente falhou: ${erroAgente.message}`)
    for (const a of (linhas ?? []) as Array<{
      id: string
      nome: unknown
      ativo: boolean | null
      arquivado_em: string | null
      conexoes: unknown
      ativado_em: string | null
    }>) {
      agentes.set(a.id, {
        id: a.id,
        nome: typeof a.nome === 'string' ? a.nome : '',
        ativo: a.ativo === true,
        arquivado: a.arquivado_em !== null,
        conexoes: Array.isArray(a.conexoes) ? a.conexoes.filter((x): x is string => typeof x === 'string') : [],
        ativadoEm: a.ativado_em,
      })
    }
  }

  const agenteDo = (c: (typeof cards)[number]): AgenteDaEtapaComNome | null => {
    const e = donoDaEtapa.get(c.stage_id)
    const a = e ? agentes.get(e.ia_agente_id) : undefined
    return e && a ? { ...a, desde: e.desde } : null
  }
  const atendeAConexao = (a: AgenteDaEtapaComNome | null) =>
    !!a && a.ativo && !a.arquivado && args.canalId !== null && a.conexoes.includes(args.canalId)
  const escolhido = cards.find((c) => atendeAConexao(agenteDo(c))) ?? cards[0]
  return {
    card: { id: escolhido.id, stageId: escolhido.stage_id, pipelineId: escolhido.pipeline_id, etapaDesde: escolhido.etapa_desde },
    agente: agenteDo(escolhido),
  }
}

/** Quantas mensagens do cliente `canalDaIaNaConversa` olha atrás da última que abre turno. */
const ULTIMAS_DO_CLIENTE_LIDAS = 10

/**
 * A conexão que decide a IA numa conversa, para a TELA: a da ÚLTIMA mensagem
 * do cliente que ABRE turno (`abreTurno`, a régua do motor — figurinha,
 * localização e toque em botão não mudam quem responde), senão a da conversa.
 * UMA função para a faixa (`GET /api/cb/ia/conversa/[id]`) e para o
 * Pausar/Retomar (`POST /api/ai/autoreply/[id]`): com réguas diferentes, a
 * faixa oferecia o botão e a rota o recusava (Codex, #309). A ordem é a de
 * gravação (`gravada_em`), a mesma de `haMensagemMaisNova`. LANÇA em erro.
 */
export async function canalDaIaNaConversa(
  db: SupabaseClient,
  conversationId: string,
  canalDaConversa: string | null,
): Promise<string | null> {
  const { data, error } = await db
    .from('messages')
    .select('channel_id, content_type, content_text, media_type')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .not('channel_id', 'is', null)
    .in('content_type', [...TIPOS_QUE_ABREM_TURNO])
    .is('deleted_at', null)
    .order('gravada_em', { ascending: false, nullsFirst: false })
    .limit(ULTIMAS_DO_CLIENTE_LIDAS)
  if (error) throw new Error(`[ia-agentes] leitura da última mensagem do cliente falhou: ${error.message}`)
  const linhas = (data ?? []) as Array<{
    channel_id: unknown
    content_type: string
    content_text: string | null
    media_type: string | null
  }>
  const ultima = linhas.find(
    (m) => typeof m.channel_id === 'string' && abreTurno({ tipo: m.content_type, texto: m.content_text, mime: m.media_type }),
  )
  return typeof ultima?.channel_id === 'string' ? ultima.channel_id : canalDaConversa
}

/**
 * Lê a conversa (e as conexões da conta), o telefone do contato e o card que
 * decide o agente, com a etapa e o agente dela (`lerCardEAgente`). `null` = a
 * conversa não é desta conta. LANÇA em erro de leitura: na entrada vira log
 * (ninguém responde), no turno vira `falhou`.
 *
 * O caso comum custa pouco: conversa e conexões numa ida; encerrada, pausada,
 * grupo ou sem contato param aí; o contato que é número da conta, na
 * segunda; sem card, na terceira; etapa sem agente, na quarta.
 */
export async function lerQuemAtende(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; canalId: string },
): Promise<LeituraDaConversa | null> {
  const [{ data: conv, error: erroConv }, { data: canais, error: erroCanal }] = await Promise.all([
    db
      .from('conversations')
      .select('id, contact_id, group_id, status, ai_autoreply_disabled, ia_pausada_por, ia_pausada_em, aguardando_desde')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    // TODAS as conexões da conta (poucas): o tipo da desta mensagem e os
    // números, para reconhecer o "cliente" que é outra conexão da conta.
    db.from('cb_channels').select('id, kind, display_phone').eq('account_id', args.accountId),
  ])
  if (erroConv) throw new Error(`leitura da conversa falhou: ${erroConv.message}`)
  if (erroCanal) throw new Error(`leitura da conexão falhou: ${erroCanal.message}`)
  if (!conv) return null
  const c = conv as {
    contact_id: string | null
    group_id: string | null
    status: string
    ai_autoreply_disabled: boolean | null
    ia_pausada_por?: string | null
    ia_pausada_em?: string | null
    aguardando_desde?: string | null
  }
  const conexoes = (canais ?? []) as Array<{ id: string; kind: string; display_phone?: unknown }>
  const canal = conexoes.find((x) => x.id === args.canalId)
  const pausada = c.ai_autoreply_disabled === true
  const leitura: LeituraDaConversa = {
    contactId: c.contact_id,
    ehGrupo: c.group_id !== null,
    // Conexão apagada (sem linha) fica fora pelo `canalId` nulo da mensagem;
    // aqui só o Instagram.
    ehInstagram: canal ? ehInstagram(canal) : false,
    ehConexaoDaConta: false,
    encerrada: c.status === 'closed',
    pausada,
    pausadaPor: pausada && typeof c.ia_pausada_por === 'string' ? c.ia_pausada_por : null,
    pausadaEm: pausada && typeof c.ia_pausada_em === 'string' ? c.ia_pausada_em : null,
    aguardandoDesde: typeof c.aguardando_desde === 'string' ? c.aguardando_desde : null,
    card: null,
    agente: null,
  }
  // A pausa PERMANENTE para aqui; a temporária (1138) precisa do card e do
  // agente (quem chama decide, com o N da conta, se ela segura).
  const pausaQueSegura = leitura.pausada && !ehMotivoTemporario(leitura.pausadaPor)
  if (leitura.ehGrupo || leitura.ehInstagram || leitura.encerrada || pausaQueSegura || !c.contact_id) return leitura

  const { data: contato, error: erroContato } = await db
    .from('contacts')
    .select('phone')
    .eq('account_id', args.accountId)
    .eq('id', c.contact_id)
    .maybeSingle()
  if (erroContato) throw new Error(`leitura do contato falhou: ${erroContato.message}`)
  leitura.ehConexaoDaConta = ehNumeroDeConexao((contato as { phone?: unknown } | null)?.phone, conexoes)
  if (leitura.ehConexaoDaConta) return leitura

  const { card, agente } = await lerCardEAgente(db, {
    accountId: args.accountId,
    contactId: c.contact_id,
    canalId: args.canalId,
  })
  leitura.card = card
  leitura.agente = agente
  return leitura
}
