import type { SupabaseClient } from '@supabase/supabase-js'
import {
  daysAgoStart,
  lastNDayKeys,
  localDayKey,
  mondayIndex,
  startOfLocalDay,
} from './date-utils'
import type {
  ActivityItem,
  ConversationsSeriesPoint,
  MetricsBundle,
  PipelineDonutData,
  PipelineStageSlice,
  ResponseTimeBucket,
  ResponseTimeSummary,
} from './types'
import { nomeDoContato } from '@/lib/contacts/identidade'
import { buscarPaginado } from '@/lib/supabase/paginar'

// ------------------------------------------------------------
// RLS scopes every query to the signed-in user automatically, so we
// never pass user_id explicitly here.
//
// ⚠️ Nada aqui baixa LINHAS de `messages` para somar no navegador: o
// PostgREST corta em 1000 sem avisar, e a conta passa disso em um dia útil.
// A série e o tempo de resposta somam no banco (RPCs da 1095, SECURITY
// INVOKER — a RLS continua valendo); os cartões contam por `count/head`; o
// feed pede 10 linhas.
// ------------------------------------------------------------

type DB = SupabaseClient

// ------------------------------------------------------------
// FILTRO POR CANAL — o que dá e o que NÃO dá para recortar.
//
// `conversations`, `messages`, `broadcasts` e `automation_logs` têm
// `channel_id` desde as migrations 902/903. `deals` ganhou o seu na 908.
// `contacts` e `pipeline_stages` continuam sem, e nem faria sentido: um
// contato pertence ao escritório, não a um número, e uma etapa é do funil.
//
// ⚠️ EM `deals` O RECORTE TEM OUTRO SIGNIFICADO, e a tela precisa dizê-lo.
// `deals.channel_id` é carimbado no NASCIMENTO do card, pelo roteador de
// entrada (e pelo passo de automação). Ele responde "por qual número este
// cliente CHEGOU", não "quanto este número tem em aberto agora" — o negócio
// segue vivo mesmo que a conversa migre para outro número depois. Daí a
// etiqueta ser "Originados neste número", e não "Conta inteira".
// Negócio criado à mão no formulário fica com a coluna NULA e, portanto,
// fora de qualquer recorte por canal.
//
// Por isso o filtro continua PARCIAL, e a tela precisa dizer quais cartões
// ele não alcança. Um número da conta inteira exibido sob um filtro de canal
// seria lido como "isto é do Comercial" — a mentira mais cara que um painel
// pode contar.
// ------------------------------------------------------------

/**
 * Aplica `channel_id = X` quando há filtro; devolve a query intacta se não.
 *
 * `Q` fica SEM constraint de propósito: escrever `Q extends { eq(...): Q }`
 * é auto-referente e faz o compilador estourar com TS2589 ("type
 * instantiation is excessively deep") no builder do PostgREST, que já é
 * profundamente genérico. O cast local resolve sem contaminar o tipo de
 * retorno — quem chama continua recebendo o builder original.
 */
export function porCanal<Q>(query: Q, channelId?: string | null): Q {
  if (!channelId) return query
  return (query as { eq: (coluna: string, valor: string) => Q }).eq(
    'channel_id',
    channelId,
  )
}

// ------------------------------------------------------------
// OS NEGÓCIOS ABERTOS — a única leitura do painel que traz LINHAS em volume.
//
// ⚠️⚠️ As duas consultas de `deals` do painel (o cartão "Valor dos negócios
// abertos" e a rosca por etapa) liam sem `range` e sem `count`. O PostgREST
// corta em ~1000 linhas SEM AVISAR: volta `error: null`, mil linhas e cara de
// completa. Hoje a conta tem 976 negócios e o defeito não aparece; a carga da
// Kommo traz ~12.700 de uma vez (`docs/PLANO-migracao-kommo.md`), e a partir
// desse dia o cartão somaria MIL negócios arbitrários e publicaria o resultado
// como total — número plausível, estável entre recarregamentos e MENOR que a
// verdade. É a pior categoria de erro de painel: ninguém desconfia dele.
//
// `linhas: null` = NÃO SABEMOS, e quem chama tem de esconder o número. Soma
// parcial apresentada como total é exatamente o que isto existe para impedir.
//
// 🔭 O certo seria AGREGAR NO BANCO: o painel não precisa das linhas, precisa
// de `sum(value)` e `count(*)` por etapa. Isso pede migration (uma RPC) e
// ficou de fora — hoje o painel baixa a mesma coleção DUAS vezes por carga,
// porque o cartão e a rosca são duas chamadas independentes na página.
// ------------------------------------------------------------

function lerNegociosAbertos<T>(db: DB, colunas: string, channelId?: string | null) {
  return buscarPaginado<T>(async (de, ate) => {
    const { data, error, count } = await porCanal(
      db.from('deals').select(colunas, { count: 'exact' }).eq('status', 'open'),
      channelId,
    )
      // ⚠️ A ordem aqui NÃO é de exibição — nada nesta leitura é exibido em
      // ordem, tudo vira soma. Ela existe porque `range` sem `order` é
      // LIMIT/OFFSET sobre ordem INDEFINIDA: uma linha que troca de posição
      // entre duas páginas vem duas vezes numa e some da outra, e a soma sai
      // errada sem erro nenhum. `id` é único, então desempata sozinho (o
      // quadro do funil precisa somar `id` ao `created_at` justamente porque
      // lá a ordem TAMBÉM é a da tela).
      .order('id', { ascending: true })
      .range(de, ate)
    return { data: (data ?? null) as T[] | null, error, count }
  })
}

/** O erro do Supabase tem propriedades NÃO enumeráveis — logar campo a campo. */
function registrarLeituraDuvidosa(
  onde: string,
  resultado: {
    motivo: string | null
    erro: {
      message: string
      details?: string | null
      hint?: string | null
      code?: string | null
    } | null
  },
) {
  console.error(`[dashboard] ${onde}: leitura de negócios não confiável`, {
    motivo: resultado.motivo,
    message: resultado.erro?.message,
    details: resultado.erro?.details,
    hint: resultado.erro?.hint,
    code: resultado.erro?.code,
  })
}

// ------------------------------------------------------------
// GRUPOS FORA DO PAINEL
//
// O painel fala de ATENDIMENTO 1:1. Um grupo ativo tem 10–50× o tráfego de
// uma conversa: deixá-lo entrar sequestra "mensagens hoje", a série e o tempo
// médio de resposta. Pior, a atividade recente lê `conversations.contacts` —
// que em grupo é NULL — e viraria uma lista de linhas sem nome.
//
// Em `conversations` o filtro é direto: `.is('group_id', null)`, escrito no
// próprio call site porque é auto-explicativo.
//
// Em `messages` NÃO existe a coluna — o recorte tem que ir pelo pai, e no
// PostgREST isso são DUAS peças que andam juntas:
//   1. o embed EMBED_SEM_GRUPO no `.select(...)`, e
//   2. o `semGrupo(...)` na query.
// Sem o embed `!inner` o filtro não recorta nada. Por isso as duas moram aqui
// lado a lado: quem copiar uma lembra da outra. (A série e o tempo de resposta
// não passam por aqui: as RPCs da 1095 cortam o grupo no próprio SQL.)
// ------------------------------------------------------------

/** Vai no `.select(...)` de toda consulta a `messages` que passe por `semGrupo`. */
const EMBED_SEM_GRUPO = 'conversations!inner(group_id)'

/** Descarta mensagens cuja conversa é de grupo. Exige EMBED_SEM_GRUPO no select. */
function semGrupo<Q>(query: Q): Q {
  return (query as { is: (coluna: string, valor: null) => Q }).is(
    'conversations.group_id',
    null,
  )
}

// --- 1. Metric cards ---------------------------------------------------

export async function loadMetrics(
  db: DB,
  channelId?: string | null,
): Promise<MetricsBundle> {
  const todayStart = startOfLocalDay().toISOString()
  const yesterdayStart = daysAgoStart(1).toISOString()

  const [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    openDeals,
    messagesToday,
    messagesYesterday,
  ] = await Promise.all([
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null),
      channelId,
    ),
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null)
        .gte('created_at', todayStart),
      channelId,
    ),
    porCanal(
      db
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')
        .is('group_id', null)
        .gte('created_at', yesterdayStart)
        .lt('created_at', todayStart),
      channelId,
    ),
    db.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', todayStart),
    db
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterdayStart)
      .lt('created_at', todayStart),
    lerNegociosAbertos<{ value: number | null }>(db, 'value', channelId),
    porCanal(
      semGrupo(
        db
          .from('messages')
          .select(`id, ${EMBED_SEM_GRUPO}`, { count: 'exact', head: true })
          .eq('sender_type', 'agent')
          // A ligação atendida no celular (1044) é linha 'agent', mas não é
          // mensagem enviada — nem a tentativa da equipe que não saiu
          // (31/10/2026).
          .neq('content_type', 'call')
          .eq('nao_saiu', false)
          .gte('created_at', todayStart),
      ),
      channelId,
    ),
    porCanal(
      semGrupo(
        db
          .from('messages')
          .select(`id, ${EMBED_SEM_GRUPO}`, { count: 'exact', head: true })
          .eq('sender_type', 'agent')
          // A ligação atendida no celular (1044) é linha 'agent', mas não é
          // mensagem enviada — nem a tentativa da equipe que não saiu
          // (31/10/2026).
          .neq('content_type', 'call')
          .eq('nao_saiu', false)
          .gte('created_at', yesterdayStart)
          .lt('created_at', todayStart),
      ),
      channelId,
    ),
  ])

  // As sete consultas de CONTAGEM acima devolvem `{ count, data, error }` sem
  // lançar, e o código só lia `count ?? 0`. Uma falha virava CARTÃO ZERADO: o
  // painel afirmava "0 conversas ativas" quando na verdade a consulta nem
  // respondeu. Zero é um número plausível — ninguém desconfia dele. Agora a
  // falha sobe e o chamador registra o erro em vez de mostrar mentira.
  const falha = [
    openConvCur,
    newConvToday,
    newConvYesterday,
    newContactsToday,
    newContactsYesterday,
    messagesToday,
    messagesYesterday,
  ].find((r) => r.error)
  if (falha?.error) throw falha.error

  // ⚠️ A leitura de negócios NÃO entra naquela lista, e a diferença é
  // deliberada: as sete acima são `count/head` (uma linha de resposta, ou
  // falha), enquanto esta percorre milhares de linhas e tem um terceiro
  // estado — "veio incompleta". Derrubar a função aqui apagaria os TRÊS
  // cartões que estão certos por causa do quarto. O quarto admite que não
  // sabe; os outros continuam na tela.
  if (!openDeals.linhas) registrarLeituraDuvidosa('cartão de negócios', openDeals)
  const negociosAbertos = openDeals.linhas && {
    value: openDeals.linhas.reduce((soma, d) => soma + (d.value ?? 0), 0),
    count: openDeals.linhas.length,
  }

  return {
    activeConversations: {
      current: openConvCur.count ?? 0,
      // "vs yesterday" on a current-state count has no clean answer
      // without snapshots — we show the delta in NEW open conversations
      // today vs yesterday. That's the business-meaningful daily signal.
      previous: (newConvToday.count ?? 0) - (newConvYesterday.count ?? 0),
    },
    newContactsToday: {
      current: newContactsToday.count ?? 0,
      previous: newContactsYesterday.count ?? 0,
    },
    openDeals: negociosAbertos,
    messagesSentToday: {
      current: messagesToday.count ?? 0,
      previous: messagesYesterday.count ?? 0,
    },
  }
}

// --- 2. Conversations over time ---------------------------------------

/**
 * O fuso em que a tela nomeia os dias (`lastNDayKeys`, `localDayKey`). As
 * RPCs da 1095 agrupam por ele: o banco roda em UTC, e agrupar lá jogaria as
 * mensagens das 21h à meia-noite no dia seguinte.
 */
function fusoDoNavegador(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export async function loadConversationsSeries(
  db: DB,
  rangeDays: number,
  channelId?: string | null,
): Promise<ConversationsSeriesPoint[]> {
  // Uma linha por dia, já somada no banco (1095). Os filtros da leitura
  // antiga — sem grupo, sem ligação (1044), sem a tentativa do robô que não
  // saiu (1080), o canal — moram na função.
  const { data, error } = await db.rpc('cb_painel_mensagens_por_dia', {
    p_desde: daysAgoStart(rangeDays - 1).toISOString(),
    p_fuso: fusoDoNavegador(),
    p_canal: channelId || null,
  })
  if (error) throw error

  const porDia = new Map(
    ((data ?? []) as { dia: string; recebidas: number; enviadas: number }[]).map((linha) => [
      linha.dia,
      linha,
    ]),
  )
  // Dia sem mensagem não vem da função: é zero DE VERDADE (a resposta veio).
  return lastNDayKeys(rangeDays).map((day) => ({
    day,
    incoming: porDia.get(day)?.recebidas ?? 0,
    outgoing: porDia.get(day)?.enviadas ?? 0,
  }))
}

// --- 3. Pipeline donut -------------------------------------------------

export async function loadPipelineDonut(
  db: DB,
  channelId?: string | null,
): Promise<PipelineDonutData> {
  const [stagesRes, dealsRes] = await Promise.all([
    // Etapas NÃO se filtram por canal: elas são do funil, não do número.
    // Também não paginam: são dezenas por conta, criadas à mão pelo operador
    // — a carga da Kommo traz NEGÓCIOS, não etapas.
    db.from('pipeline_stages').select('id, name, color, pipeline_id, position').order('position'),
    lerNegociosAbertos<{ stage_id: string; value: number | null }>(
      db,
      'stage_id, value',
      channelId,
    ),
  ])

  // ⚠️ Sem as etapas não há como NOMEAR fatia nenhuma, e o código antigo lia
  // `stagesRes.data ?? []`: a consulta que falhava virava rosca vazia, e a
  // rosca vazia diz "Nenhum negócio aberto ainda" — lista vazia virando
  // AFIRMAÇÃO, sobre uma conta que pode ter milhares de negócios em aberto.
  if (stagesRes.error) {
    console.error('[dashboard] rosca do funil: etapas não carregaram', {
      message: stagesRes.error.message,
      details: stagesRes.error.details,
      hint: stagesRes.error.hint,
      code: stagesRes.error.code,
    })
    return { confiavel: false }
  }
  if (!dealsRes.linhas) {
    registrarLeituraDuvidosa('rosca do funil', dealsRes)
    return { confiavel: false }
  }

  const stages =
    (stagesRes.data ?? []) as { id: string; name: string; color: string }[]
  const deals = dealsRes.linhas

  const byStage = new Map<string, { count: number; total: number }>()
  for (const d of deals) {
    const row = byStage.get(d.stage_id) ?? { count: 0, total: 0 }
    row.count += 1
    row.total += d.value ?? 0
    byStage.set(d.stage_id, row)
  }

  const slices: PipelineStageSlice[] = stages
    .map((s) => ({
      id: s.id,
      name: s.name,
      color: s.color || '#64748b',
      dealCount: byStage.get(s.id)?.count ?? 0,
      totalValue: byStage.get(s.id)?.total ?? 0,
    }))
    // Hide empty stages from the ring (but we'd still show them in the
    // legend if the user wanted a full breakdown — trimming keeps the
    // visual clean for the common case).
    .filter((s) => s.totalValue > 0 || s.dealCount > 0)

  return {
    confiavel: true,
    stages: slices,
    totalValue: slices.reduce((sum, s) => sum + s.totalValue, 0),
  }
}

// --- 4. Response time by day of week ----------------------------------

export async function loadResponseTime(
  db: DB,
  channelId?: string | null,
): Promise<ResponseTimeSummary> {
  // The last 14 days give us both "this week" + "last week" with enough
  // overlap if the user opens the dashboard late on a Monday.
  //
  // Os pares "primeira fala do cliente sem resposta → próxima fala de fora"
  // são montados no banco (1095), que devolve, por dia do cliente, quantas
  // amostras e quantos minutos somados. Aqui só se junta por dia da semana e
  // por semana — média de soma ÷ amostras é a mesma média das amostras.
  const { data, error } = await db.rpc('cb_painel_tempo_de_resposta', {
    p_desde: daysAgoStart(13).toISOString(),
    p_fuso: fusoDoNavegador(),
    p_canal: channelId || null,
  })
  if (error) throw error

  const now = new Date()
  // Início das semanas como CHAVE de dia: o dia que a função devolve é o do
  // mesmo fuso, e comparar "AAAA-MM-DD" como texto é comparar datas.
  const thisWeekStart = localDayKey(daysAgoStart(mondayIndex(now)))
  const lastWeekStart = localDayKey(daysAgoStart(mondayIndex(now) + 7))

  // Per-day-of-week buckets, averaged over both weeks' worth of data
  // so each bar has more samples to stand on. If a day has no samples
  // its avgMinutes stays null and the chart renders the bar muted.
  type Soma = { minutos: number; amostras: number }
  const vazio = (): Soma => ({ minutos: 0, amostras: 0 })
  const byDow = Array.from({ length: 7 }, vazio)
  const thisWeek = vazio()
  const lastWeek = vazio()
  const somar = (alvo: Soma, linha: { amostras: number; soma_minutos: number }) => {
    alvo.minutos += linha.soma_minutos
    alvo.amostras += linha.amostras
  }

  for (const linha of (data ?? []) as { dia: string; amostras: number; soma_minutos: number }[]) {
    const [y, m, d] = linha.dia.split('-').map(Number)
    somar(byDow[mondayIndex(new Date(y, m - 1, d))], linha)
    if (linha.dia >= thisWeekStart) somar(thisWeek, linha)
    else if (linha.dia >= lastWeekStart) somar(lastWeek, linha)
  }

  const avg = (s: Soma) => (s.amostras === 0 ? null : s.minutos / s.amostras)

  const buckets: ResponseTimeBucket[] = byDow.map((s, dow) => ({
    dow,
    avgMinutes: avg(s),
    samples: s.amostras,
  }))

  return {
    buckets,
    thisWeekAvg: avg(thisWeek),
    lastWeekAvg: avg(lastWeek),
  }
}

// --- 5. Activity feed --------------------------------------------------

type ContatoDoFeed = { name: string | null; phone: string | null; wa_username?: string | null; instagram_username?: string | null }

export async function loadActivity(
  db: DB,
  limit = 20,
  channelId?: string | null,
): Promise<ActivityItem[]> {
  // Pull ~10 from each source (plenty of headroom after merge-sort),
  // then interleave by timestamp. The individual per-table limits
  // keep the payload small; the final limit is enforced after sort.
  //
  // Com filtro de canal, contatos e negócios saem do feed. Não é perda: um
  // contato criado não pertence a número nenhum, e mostrá-lo sob o recorte
  // "Comercial" o faria parecer originado ali.
  const semCanal = !channelId
  const [msgs, contacts, deals, broadcasts, autoLogs] = await Promise.all([
    porCanal(
      // `conversations` já era embutido aqui; vira `!inner` e ganha `group_id`
      // para o semGrupo poder recortar. Sem isso o feed listaria mensagem de
      // grupo com `contacts` NULL — uma linha sem nome nenhum na tela.
      semGrupo(
        db
          .from('messages')
          .select(
            'id, content_text, sender_type, created_at, conversation_id, conversations!inner(group_id, contact_id, contacts(name, phone, wa_username, instagram_username))',
          )
          .eq('sender_type', 'customer')
          // A ligação perdida (1044) não tem texto: no feed seria uma "nova
          // mensagem" em branco.
          .neq('content_type', 'call'),
      ),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(10),
    semCanal
      ? db
          .from('contacts')
          .select('id, name, phone, wa_username, instagram_username, created_at')
          .order('created_at', { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
    // Negócios voltaram ao feed sob filtro: desde a 908 eles têm canal.
    // (`contacts` acima continua fora — contato não pertence a um número.)
    porCanal(
      db.from('deals').select('id, title, updated_at, stage:pipeline_stages(name)'),
      channelId,
    )
      .order('updated_at', { ascending: false })
      .limit(10),
    porCanal(
      db.from('broadcasts').select('id, name, status, total_recipients, created_at'),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(5),
    porCanal(
      db
        .from('automation_logs')
        .select('id, trigger_event, status, created_at, automation:automations(name), contact:contacts(name, phone, wa_username, instagram_username)'),
      channelId,
    )
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const items: ActivityItem[] = []

  // PostgREST returns nested selections as arrays by default, even when
  // the foreign key is 1:1. We normalise by taking [0] on each level.
  for (const m of (msgs.data ?? []) as unknown as Array<{
    id: string
    content_text: string | null
    created_at: string
    conversation_id: string
    conversations:
      | { contact_id: string | null; contacts: ContatoDoFeed[] | ContatoDoFeed | null }[]
      | { contact_id: string | null; contacts: ContatoDoFeed[] | ContatoDoFeed | null }
      | null
  }>) {
    const conv = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations
    const contact = Array.isArray(conv?.contacts) ? conv?.contacts[0] : conv?.contacts
    items.push({
      id: `msg-${m.id}`,
      kind: 'message',
      quem: nomeDoContato(contact, '') || null,
      at: m.created_at,
      href: `/inbox?c=${m.conversation_id}`,
    })
  }

  for (const c of (contacts.data ?? []) as Array<{ id: string; name: string | null; phone: string | null; wa_username?: string | null; instagram_username?: string | null; created_at: string }>) {
    items.push({
      id: `contact-${c.id}`,
      kind: 'contact',
      quem: nomeDoContato(c, '') || null,
      at: c.created_at,
      href: '/contacts',
    })
  }

  for (const d of (deals.data ?? []) as unknown as Array<{
    id: string
    title: string
    updated_at: string
    stage: { name: string }[] | { name: string } | null
  }>) {
    const stage = Array.isArray(d.stage) ? d.stage[0] : d.stage
    items.push({
      id: `deal-${d.id}`,
      kind: 'deal',
      titulo: d.title,
      etapa: stage?.name ?? null,
      at: d.updated_at,
      href: '/pipelines',
    })
  }

  for (const b of (broadcasts.data ?? []) as Array<{
    id: string
    name: string
    status: string
    total_recipients: number | null
    created_at: string
  }>) {
    items.push({
      id: `broadcast-${b.id}`,
      kind: 'broadcast',
      nome: b.name,
      status: b.status,
      // A coluna é anulável (001) e vai para um plural ICU, que quer número.
      total: b.total_recipients ?? 0,
      at: b.created_at,
      href: '/broadcasts',
    })
  }

  for (const l of (autoLogs.data ?? []) as unknown as Array<{
    id: string
    trigger_event: string
    status: string
    created_at: string
    automation: { name: string }[] | { name: string } | null
    contact: ContatoDoFeed[] | ContatoDoFeed | null
  }>) {
    const automation = Array.isArray(l.automation) ? l.automation[0] : l.automation
    const contact = Array.isArray(l.contact) ? l.contact[0] : l.contact
    items.push({
      id: `auto-${l.id}`,
      kind: 'automation',
      automacao: automation?.name || null,
      falhou: l.status === 'failed',
      quem: nomeDoContato(contact, '') || null,
      at: l.created_at,
    })
  }

  return items
    .sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0))
    .slice(0, limit)
}
