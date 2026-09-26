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
//      transferência, uma automação) → ninguém;
//   4. sem card aberto, etapa sem agente, agente desligado ou arquivado,
//      agente sem a conexão, card anterior ao agente (D27) → ninguém;
//   5. senão → o agente da etapa, com o card e a etapa (o turno confere que
//      continuam os mesmos até o envio).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ehInstagram } from '@/lib/cb-channels/transporte'

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
 * Não abrem: tipo fora de `TIPOS_QUE_ABREM_TURNO` (localização, botão),
 * figurinha e texto sem nada visível — na Evolution, cartão de contato,
 * enquete e resposta de botão chegam como `text` com `content_text` nulo —,
 * e o rótulo do tipo que a Meta entrega e a rota não sabe ler
 * (`PREFIXO_DE_TIPO_NAO_SUPORTADO`), que também é gravado como `text`.
 */
export function abreTurno(c: ConteudoDaMensagem): boolean {
  if (!TIPOS_QUE_ABREM_TURNO.has(c.tipo)) return false
  if (c.tipo === 'image' && c.mime?.split(';')[0].trim().toLowerCase() === MIME_DA_FIGURINHA) return false
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

export type QuemResponde =
  | { quem: 'ninguem'; motivo: MotivoDeNinguem }
  | { quem: 'agente'; agenteId: string; dealId: string; stageId: string }

function instante(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function quemResponde(f: FatosDaMensagem): QuemResponde {
  if (f.ehGrupo || f.ehInstagram || !f.canalId) return { quem: 'ninguem', motivo: 'fora_do_alcance' }
  if (f.ehRespostaDeBotao || !abreTurno(f.conteudo)) return { quem: 'ninguem', motivo: 'nao_abre_turno' }
  if (f.roboConsumiu) return { quem: 'ninguem', motivo: 'robo' }
  if (f.automacaoFalou) return { quem: 'ninguem', motivo: 'automacao_falou' }
  if (f.encerrada) return { quem: 'ninguem', motivo: 'encerrada' }
  if (f.pausada) return { quem: 'ninguem', motivo: 'pausada' }
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
  return { quem: 'agente', agenteId: f.agente.id, dealId: f.card.id, stageId: f.card.stageId }
}

// ------------------------------------------------------------
// A leitura dos fatos (I/O, o cliente por parâmetro)
// ------------------------------------------------------------

/** O que `lerQuemAtende` leu do banco: tudo que `quemResponde` precisa além da mensagem. */
export interface LeituraDaConversa {
  contactId: string | null
  ehGrupo: boolean
  ehInstagram: boolean
  encerrada: boolean
  pausada: boolean
  card: CardDoContato | null
  agente: AgenteDaEtapa | null
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
 * Lê a conversa (e a conexão), o card ABERTO mais recente do contato, a
 * linha da etapa dele em `cb_ia_agente_etapas` e o agente. `null` = a
 * conversa não é desta conta. LANÇA em erro de leitura: na entrada vira log
 * (ninguém responde), no turno vira `falhou`.
 *
 * O caso comum custa pouco: conversa e conexão numa ida; encerrada, pausada,
 * grupo ou sem contato param aí; sem card, na segunda; etapa sem agente, na
 * terceira.
 */
export async function lerQuemAtende(
  db: SupabaseClient,
  args: { accountId: string; conversationId: string; canalId: string },
): Promise<LeituraDaConversa | null> {
  const [{ data: conv, error: erroConv }, { data: canal, error: erroCanal }] = await Promise.all([
    db
      .from('conversations')
      .select('id, contact_id, group_id, status, ai_autoreply_disabled')
      .eq('id', args.conversationId)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    db.from('cb_channels').select('kind').eq('id', args.canalId).eq('account_id', args.accountId).maybeSingle(),
  ])
  if (erroConv) throw new Error(`leitura da conversa falhou: ${erroConv.message}`)
  if (erroCanal) throw new Error(`leitura da conexão falhou: ${erroCanal.message}`)
  if (!conv) return null
  const c = conv as {
    contact_id: string | null
    group_id: string | null
    status: string
    ai_autoreply_disabled: boolean | null
  }
  const leitura: LeituraDaConversa = {
    contactId: c.contact_id,
    ehGrupo: c.group_id !== null,
    // Conexão apagada (sem linha) fica fora pelo `canalId` nulo da mensagem;
    // aqui só o Instagram.
    ehInstagram: canal ? ehInstagram(canal as { kind: string }) : false,
    encerrada: c.status === 'closed',
    pausada: c.ai_autoreply_disabled === true,
    card: null,
    agente: null,
  }
  if (leitura.ehGrupo || leitura.ehInstagram || leitura.encerrada || leitura.pausada || !c.contact_id) return leitura

  const { data: deal, error: erroDeal } = await db
    .from('deals')
    .select('id, stage_id, pipeline_id, etapa_desde')
    .eq('account_id', args.accountId)
    .eq('contact_id', c.contact_id)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (erroDeal) throw new Error(`leitura do card falhou: ${erroDeal.message}`)
  const d = deal as { id: string; stage_id: string; pipeline_id: string; etapa_desde: string | null } | null
  if (!d) return leitura
  leitura.card = { id: d.id, stageId: d.stage_id, pipelineId: d.pipeline_id, etapaDesde: d.etapa_desde }

  const { data: etapa, error: erroEtapa } = await db
    .from('cb_ia_agente_etapas')
    .select('ia_agente_id, desde')
    .eq('stage_id', d.stage_id)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (erroEtapa) throw new Error(`leitura da etapa falhou: ${erroEtapa.message}`)
  const e = etapa as { ia_agente_id: string; desde: string | null } | null
  if (!e) return leitura

  const { data: ag, error: erroAgente } = await db
    .from('cb_ia_agentes')
    .select('id, ativo, arquivado_em, conexoes, ativado_em')
    .eq('id', e.ia_agente_id)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (erroAgente) throw new Error(`leitura do agente falhou: ${erroAgente.message}`)
  const a = ag as {
    id: string
    ativo: boolean | null
    arquivado_em: string | null
    conexoes: unknown
    ativado_em: string | null
  } | null
  if (!a) return leitura
  leitura.agente = {
    id: a.id,
    ativo: a.ativo === true,
    arquivado: a.arquivado_em !== null,
    conexoes: Array.isArray(a.conexoes) ? a.conexoes.filter((x): x is string => typeof x === 'string') : [],
    ativadoEm: a.ativado_em,
    desde: e.desde,
  }
  return leitura
}
