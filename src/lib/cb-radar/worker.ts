// ============================================================
// O worker do Radar: acha conversas que precisam de análise, reivindica,
// calcula métricas, chama a IA (quando configurada) e grava o insight.
//
// Roda em service-role (o agendador da VPS bate na rota de cron sem
// usuário logado) — por isso TODA consulta escopa account_id/ids
// explícitos e as FKs compostas da 941 são a rede de segurança.
//
// Desenho herdado das mensagens agendadas (925–928):
//   - reivindicação por `status='running'` + `running_desde`;
//   - recolhedor de linhas travadas no começo de cada ciclo;
//   - lote pequeno e parada antecipada por tempo.
//
// Diferença deliberada: aqui retentar é SEGURO (nada sai para o
// cliente), então falha vira `failed` + `tentativas`, sem análogo de
// `entrega_incerta`.
//
// ⚠️ CERCA DE POSSE em toda escrita pós-claim: os UPDATEs de sucesso e
// de falha filtram por `status='running'` E `running_desde=<carimbo do
// próprio claim>`. Sem a cerca, um worker que estourou o tempo e foi
// "recolhido" aos 10min continuava com direito de escrita e atropelava
// a análise seguinte da mesma conversa (revisão 2026-08-27).
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { generateStructured } from '@/lib/ai/structured'
import { logAiUsage } from '@/lib/ai/usage'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import type { AiUsage } from '@/lib/ai/types'
import { CICLO_MINUTOS } from '@/lib/scheduled/display'
import { calcularMetricas, type MensagemParaMetricas } from './metricas'
import { JANELA_DIAS } from './ordenacao'
import { extrairNumerosDeProcesso } from './processos'
import {
  RADAR_SCHEMA,
  interpretarAnalise,
  montarPromptDoRadar,
  montarTranscrito,
  type AnaliseInterpretada,
  type MensagemParaTranscrito,
} from './rubrica'

export { JANELA_DIAS }
/** Conversas por ciclo. Bem abaixo dos 20 das agendadas: lá cada item é
 *  um POST à Evolution; aqui é uma geração de LLM. */
const POR_CICLO = 5
/**
 * Não reanalisar a mesma conversa antes disso, mesmo com mensagem nova.
 * DERIVADO da cadência real do agendador (o laço lento bate a cada
 * `CICLO_MINUTOS`): dois ciclos de folga. Amarrar os dois é o que impede
 * o throttle de virar letra morta se a cadência mudar na VPS.
 */
export const THROTTLE_MS = CICLO_MINUTOS * 2 * 60_000
/** `running` mais velho que isto é worker que morreu no meio. Acima do
 *  pior caso de uma análise (timeout de rede + escritas). */
const TRAVADA_MIN = 10
const TENTATIVAS_MAX = 3
/** Alvo "confortável" do ciclo — a partir daqui, não se COMEÇA item novo. */
const TEMPO_LIMITE_MS = 45_000
/**
 * Teto ABSOLUTO: nenhum item novo começa se `gasto + timeout da chamada`
 * puder passar disto. O limite real em produção é o `curl -m 120` do
 * agendador (o `maxDuration` da rota é convenção serverless e NÃO é
 * aplicado no VPS — o container roda `node server.js`, conferido no
 * Dockerfile e no serviço em 2026-08-27). 110s deixa folga para as
 * escritas finais. Importante porque `AI_REQUEST_TIMEOUT_MS` é env livre:
 * um operador que a suba para acomodar um modelo lento não pode, sem
 * querer, fazer o ciclo estourar o curl e órfã linhas em `running`.
 */
const TETO_ABSOLUTO_MS = 110_000
const MAX_TOKENS_RADAR = 2048
const TETO_MENSAGENS_JANELA = 1000

export interface ResultadoDoCiclo {
  candidatas: number
  analisadas: number
  falhas: number
  puladas: number
  travadasRecolhidas: number
}

interface ConversaCandidata {
  id: string
  account_id: string
  channel_id: string | null
  last_message_at: string | null
}

interface InsightExistente {
  id: string
  conversation_id: string
  status: string
  janela_fim: string | null
  analisado_em: string | null
  tentativas: number
}

interface Reivindicacao {
  id: string
  /** O carimbo que ESTE claim gravou em `running_desde` — a cerca de
   *  posse de toda escrita subsequente. */
  claimIso: string
  /** `tentativas` FRESCO, lido pelo RETURNING do próprio claim — o valor
   *  do retrato pré-claim pode ter envelhecido (reanálise manual no
   *  meio) e faria o contador andar para trás. */
  tentativas: number
}

/** Um ciclo completo: recolhe travadas, escolhe o lote e analisa. */
export async function rodarCicloDoRadar(
  admin: SupabaseClient,
  opts: { tempoLimiteMs?: number } = {},
): Promise<ResultadoDoCiclo> {
  const inicioCiclo = Date.now()
  const tempoLimiteMs = opts.tempoLimiteMs ?? TEMPO_LIMITE_MS
  const resultado: ResultadoDoCiclo = {
    candidatas: 0,
    analisadas: 0,
    falhas: 0,
    puladas: 0,
    travadasRecolhidas: 0,
  }

  resultado.travadasRecolhidas = await recolherTravadas(admin)

  // Opt-in por canal: sem canal ligado, o ciclo é um SELECT e nada mais.
  const { data: canais, error: canaisErr } = await admin
    .from('cb_channels')
    .select('id')
    .eq('radar_enabled', true)
  if (canaisErr) throw new Error(`radar: falha lendo canais: ${canaisErr.message}`)
  if (!canais || canais.length === 0) return resultado

  const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString()
  // Ordem por atividade recente = a prioridade das últimas 72h de graça:
  // o lote sai do topo da lista.
  const { data: convs, error: convsErr } = await admin
    .from('conversations')
    .select('id, account_id, channel_id, last_message_at')
    .in('channel_id', canais.map((c) => c.id))
    .is('group_id', null)
    .gte('last_message_at', desde)
    .order('last_message_at', { ascending: false })
    .limit(300)
  if (convsErr) throw new Error(`radar: falha lendo conversas: ${convsErr.message}`)
  if (!convs || convs.length === 0) return resultado

  const { data: insights, error: insErr } = await admin
    .from('cb_conversation_insights')
    .select('id, conversation_id, status, janela_fim, analisado_em, tentativas')
    .in('conversation_id', convs.map((c) => c.id))
  if (insErr) throw new Error(`radar: falha lendo insights: ${insErr.message}`)

  const porConversa = new Map(
    ((insights ?? []) as InsightExistente[]).map((i) => [i.conversation_id, i]),
  )
  const agora = Date.now()
  const candidatas = (convs as ConversaCandidata[]).filter((c) =>
    precisaDeAnalise(c, porConversa.get(c.id), agora),
  )
  resultado.candidatas = candidatas.length

  for (const conversa of candidatas.slice(0, POR_CICLO)) {
    // Dois relógios: o alvo do ciclo, e o teto absoluto que soma o custo
    // do item QUE VAI COMEÇAR — conferir só o passado deixava um item
    // iniciado aos 44s estourar o curl do agendador (revisão 2026-08-27).
    const gastoMs = Date.now() - inicioCiclo
    if (gastoMs > tempoLimiteMs) break
    if (gastoMs + aiRequestTimeoutMs() > TETO_ABSOLUTO_MS) break

    const existente = porConversa.get(conversa.id)
    // Reivindicação COM revalidação de throttle: o retrato lá de cima
    // envelhece (uma reanálise manual pode ter concluído no meio do
    // ciclo), e a CAS de "ninguém rodando" não substitui a regra de
    // negócio. A condição extra no próprio UPDATE fecha a janela sem
    // segunda leitura.
    const reivindicado = await reivindicar(admin, conversa, existente, {
      respeitarThrottle: true,
    })
    if (!reivindicado) {
      resultado.puladas += 1
      continue
    }

    try {
      await analisarConversaReivindicada(admin, {
        insightId: reivindicado.id,
        claimIso: reivindicado.claimIso,
        conversationId: conversa.id,
        accountId: conversa.account_id,
        channelId: conversa.channel_id,
      })
      resultado.analisadas += 1
    } catch (err) {
      resultado.falhas += 1
      const motivo = err instanceof Error ? err.message : 'erro desconhecido'
      console.error(`[radar] análise da conversa ${conversa.id} falhou:`, motivo)
      await marcarFalha(admin, reivindicado, motivo)
    }
  }

  return resultado
}

/**
 * Exportada para o teste — as regras daqui já produziram o bug mais caro
 * da revisão (retentativa infinita) e precisam de regressão coberta.
 */
export function precisaDeAnalise(
  conversa: ConversaCandidata,
  insight: InsightExistente | undefined,
  agoraMs: number,
): boolean {
  if (!insight) return true
  if (insight.status === 'running') return false

  // ⚠️ "Mensagem nova" exige uma MARCA D'ÁGUA REAL. `janela_fim` nulo
  // significa "nunca completou uma análise" — tratá-lo como "tem coisa
  // nova" fazia toda linha que só falhou passar por cima do teto de
  // tentativas e virar retentativa paga a cada ciclo, para sempre
  // (revisão 2026-08-27: quatro ângulos acharam este bug).
  const temMsgNova =
    insight.janela_fim !== null &&
    conversa.last_message_at !== null &&
    conversa.last_message_at > insight.janela_fim

  if (insight.status === 'failed') {
    // Retentável até o teto; mensagem nova DE VERDADE zera a régua — o
    // conteúdo mudou, a falha antiga não conta mais a história.
    return temMsgNova || insight.tentativas < TENTATIVAS_MAX
  }

  if (!temMsgNova) return false
  const analisadoHa = insight.analisado_em
    ? agoraMs - Date.parse(insight.analisado_em)
    : Number.POSITIVE_INFINITY
  return analisadoHa >= THROTTLE_MS
}

/** Linhas presas em `running` além do teto viram `failed` (worker morto
 *  no meio). Uma a uma porque o incremento de `tentativas` precisa do
 *  valor atual — travada é rara, o custo não importa. */
async function recolherTravadas(admin: SupabaseClient): Promise<number> {
  const corte = new Date(Date.now() - TRAVADA_MIN * 60_000).toISOString()
  const { data: presas, error } = await admin
    .from('cb_conversation_insights')
    .select('id, tentativas')
    .eq('status', 'running')
    // `running_desde` nulo com status `running` é inalcançável pelo
    // código — mas se aparecer (escrita manual, versão antiga), `.lt()`
    // sozinho nunca casa NULL e a linha ficaria presa para sempre.
    .or(`running_desde.lt.${corte},running_desde.is.null`)
  if (error) {
    // "A consulta falhou" ≠ "não havia nada preso": engolir o erro faria
    // linhas travadas sumirem do Radar em silêncio.
    console.error('[radar] recolhedor não conseguiu ler as travadas:', error.message)
    return 0
  }
  if (!presas || presas.length === 0) return 0

  let recolhidas = 0
  for (const p of presas as { id: string; tentativas: number }[]) {
    const { error: upErr } = await admin
      .from('cb_conversation_insights')
      .update({
        status: 'failed',
        erro: 'análise interrompida no meio — recolhida pelo ciclo seguinte',
        tentativas: p.tentativas + 1,
        running_desde: null,
      })
      .eq('id', p.id)
      .eq('status', 'running')
    if (upErr) {
      console.error(`[radar] recolhedor não gravou a travada ${p.id}:`, upErr.message)
    } else {
      recolhidas += 1
    }
  }
  return recolhidas
}

async function reivindicar(
  admin: SupabaseClient,
  conversa: ConversaCandidata,
  existente: InsightExistente | undefined,
  opts: { respeitarThrottle: boolean },
): Promise<Reivindicacao | null> {
  const claimIso = new Date().toISOString()
  if (existente) {
    let query = admin
      .from('cb_conversation_insights')
      .update({ status: 'running', running_desde: claimIso })
      .eq('id', existente.id)
      .neq('status', 'running')
    if (opts.respeitarThrottle) {
      const corte = new Date(Date.now() - THROTTLE_MS).toISOString()
      query = query.or(`analisado_em.is.null,analisado_em.lt.${corte}`)
    }
    const { data } = await query.select('id, tentativas').maybeSingle()
    return data ? { id: data.id, claimIso, tentativas: data.tentativas ?? 0 } : null
  }
  // Linha nova. `ignoreDuplicates` + índice ÚNICO TOTAL (941): se outro
  // ciclo inseriu no meio-tempo, volta vazio e este pula a conversa.
  const { data } = await admin
    .from('cb_conversation_insights')
    .upsert(
      {
        conversation_id: conversa.id,
        account_id: conversa.account_id,
        channel_id: conversa.channel_id,
        status: 'running',
        running_desde: claimIso,
      },
      { onConflict: 'conversation_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  return data ? { id: data.id, claimIso, tentativas: 0 } : null
}

/** O UPDATE de falha, com a cerca de posse. Três chamadores (ciclo,
 *  reanálise manual e — sem cerca, porque ele É o ladrão — o recolhedor
 *  tem o dele próprio); uma política de retentativa só. */
async function marcarFalha(
  admin: SupabaseClient,
  claim: Reivindicacao,
  motivo: string,
): Promise<void> {
  const { data, error } = await admin
    .from('cb_conversation_insights')
    .update({
      status: 'failed',
      erro: motivo.slice(0, 500),
      tentativas: claim.tentativas + 1,
      running_desde: null,
    })
    .eq('id', claim.id)
    .eq('status', 'running')
    .eq('running_desde', claim.claimIso)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error(`[radar] não gravou a falha do insight ${claim.id}:`, error.message)
  } else if (!data) {
    // Outro ator (recolhedor + novo claim) assumiu a linha no meio-tempo;
    // o estado dele é mais novo que o nosso erro — não atropelar.
    console.warn(`[radar] falha do insight ${claim.id} descartada: linha reivindicada por outro worker`)
  }
}

interface MensagemDaJanela {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  created_at: string | null
}

/**
 * A análise de UMA conversa já reivindicada. Grava `done` no sucesso;
 * quem chama trata o erro (ciclo marca `failed`, rota devolve 502).
 *
 * Sem chave de IA a análise NÃO falha: grava as métricas determinísticas
 * e os processos por regex — o painel funciona no dia 1, sem chave, e
 * diz o que falta.
 */
export async function analisarConversaReivindicada(
  admin: SupabaseClient,
  args: {
    insightId: string
    claimIso: string
    conversationId: string
    accountId: string
    channelId: string | null
  },
): Promise<{ semIa: boolean }> {
  const janelaFim = new Date()
  const janelaInicio = new Date(janelaFim.getTime() - JANELA_DIAS * 86_400_000)

  // ⚠️ DESC + reverse: com mais mensagens que o teto, quem cai é o
  // COMEÇO da janela, nunca o fim — o recente é o que decide urgência e
  // pendência. Com ASC, o corte jogava fora exatamente as mensagens de
  // hoje e `aguardando_desde` afirmava "ninguém aguardando" numa conversa
  // esperando resposta (revisão 2026-08-27: quatro ângulos).
  const { data: mensagens, error: msgErr } = await admin
    .from('messages')
    .select('id, sender_type, content_type, content_text, created_at')
    .eq('conversation_id', args.conversationId)
    .gte('created_at', janelaInicio.toISOString())
    .is('deleted_at', null)
    .neq('content_type', 'system')
    .order('created_at', { ascending: false })
    .limit(TETO_MENSAGENS_JANELA)
  if (msgErr) throw new Error(`falha lendo mensagens: ${msgErr.message}`)

  const linhas = ((mensagens ?? []) as MensagemDaJanela[]).reverse()
  const janelaCortada = linhas.length >= TETO_MENSAGENS_JANELA
  if (janelaCortada) {
    console.warn(
      `[radar] conversa ${args.conversationId} tem mais de ${TETO_MENSAGENS_JANELA} mensagens na janela — as mais antigas ficaram fora`,
    )
  }
  const comData = linhas.filter((m) => m.created_at !== null)

  const metricas = calcularMetricas(
    comData.map(
      (m): MensagemParaMetricas => ({
        senderType: m.sender_type,
        createdAt: new Date(m.created_at as string),
      }),
    ),
  )

  const comTexto = comData.filter((m) => m.content_text && m.content_text.trim())
  const semTexto = comData.length - comTexto.length
  const transcrito = montarTranscrito(
    comTexto.map(
      (m): MensagemParaTranscrito => ({
        id: m.id,
        senderType: m.sender_type,
        createdAt: new Date(m.created_at as string),
        texto: m.content_text as string,
      }),
    ),
  )
  const processosPorRegex = extrairNumerosDeProcesso(
    comTexto.map((m) => m.content_text).join('\n'),
  )

  // Agente do canal com queda para o padrão da conta — a resolução da
  // 903, MAS com `requireActive: false`: o Radar precisa da CREDENCIAL;
  // `is_active` é o interruptor do assistente DE CONVERSA (auto-reply/
  // rascunho). Amarrar os dois fazia "desliguei as respostas automáticas
  // deste número" silenciar a análise sem nenhum aviso na tela.
  const config = await loadAiConfig(admin, args.accountId, {
    requireActive: false,
    channelId: args.channelId,
  })

  let analise: AnaliseInterpretada | null = null
  let usage: AiUsage | null = null
  if (config && transcrito.linhas.length > 0) {
    const { systemPrompt, userContent } = montarPromptDoRadar({
      transcrito,
      metricas,
      mensagensSemTexto: semTexto,
      processosPorRegex,
      janelaDias: JANELA_DIAS,
    })
    const resposta = await generateStructured({
      config,
      systemPrompt,
      userContent,
      schema: RADAR_SCHEMA,
      maxOutputTokens: MAX_TOKENS_RADAR,
    })
    usage = resposta.usage
    // ⚠️ O uso é registrado ANTES de interpretar: os tokens já foram
    // COBRADOS na chave da conta mesmo que a resposta seja lixo — jogar o
    // custo fora junto com a resposta subnotificava exatamente as
    // análises que mais custaram.
    void logAiUsage(admin, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      mode: 'radar',
      channelId: args.channelId,
      provider: config.provider,
      model: config.model,
      usage,
    })
    analise = interpretarAnalise(resposta.object, transcrito.linhas)
    if (!analise) {
      throw new Error('a IA respondeu num formato que não é um objeto de análise')
    }
  }

  const semIa = config === null
  const ultima = comData[comData.length - 1]
  const { data: gravado, error: upErr } = await admin
    .from('cb_conversation_insights')
    .update({
      channel_id: args.channelId,
      janela_inicio: janelaInicio.toISOString(),
      janela_fim: janelaFim.toISOString(),
      ultima_mensagem_analisada_id: ultima?.id ?? null,
      mensagens_analisadas: comData.length,
      mensagens_sem_texto: semTexto,

      nota: analise?.nota ?? null,
      urgencia: analise?.urgencia ?? 'nenhuma',
      insatisfacao: analise?.insatisfacao ?? false,
      mencao_processo: (analise?.mencaoProcesso ?? false) || processosPorRegex.length > 0,
      pedidos_abertos: analise?.pedidosNaoAtendidos.length ?? 0,
      resumo: analise?.resumo || null,
      detalhes: {
        // Só "sem chave de IA". Conversa com chave mas sem NENHUM texto
        // (só áudio/mídia) não leva o selo — `mensagens_sem_texto` já
        // conta essa lacuna com o rótulo certo; misturar as duas causas
        // mandava o operador caçar defeito na chave que está funcionando.
        sem_ia: semIa,
        // Cobre os DOIS cortes: o teto de 1000 linhas da leitura do banco
        // e o teto de 200 mensagens/60k chars do transcrito — em ambos, a
        // análise não viu a janela inteira e a tela tem de dizer isso.
        janela_cortada: janelaCortada || transcrito.cortadas > 0,
        processos: processosPorRegex,
        analise,
      },

      primeira_resposta_seg: metricas.primeiraRespostaSeg,
      resposta_mediana_seg: metricas.respostaMedianaSeg,
      aguardando_desde: metricas.aguardandoDesde?.toISOString() ?? null,

      status: 'done',
      running_desde: null,
      erro: null,
      tentativas: 0,
      analisado_em: janelaFim.toISOString(),

      provider: config?.provider ?? null,
      model: config?.model ?? null,
      prompt_tokens: usage?.promptTokens ?? 0,
      completion_tokens: usage?.completionTokens ?? 0,
    })
    .eq('id', args.insightId)
    // A cerca de posse: se o recolhedor nos deu por mortos e outro claim
    // assumiu, este resultado é o mais VELHO dos dois — vira no-op.
    .eq('status', 'running')
    .eq('running_desde', args.claimIso)
    .select('id')
    .maybeSingle()
  if (upErr) throw new Error(`falha gravando o insight: ${upErr.message}`)
  if (!gravado) {
    console.warn(
      `[radar] resultado do insight ${args.insightId} descartado: linha reivindicada por outro worker durante a análise`,
    )
    return { semIa }
  }

  // ⚠️ CICLO DE VIDA DO SINAL — o reset de `estado` é CONDICIONAL e
  // separado do UPDATE principal, de propósito:
  //   - `tratado` reabre SÓ se o CLIENTE falou depois do tratamento
  //     (`estado_em < última mensagem do cliente`). A resposta do próprio
  //     operador não reabre, e um clique dado DURANTE a análise
  //     (estado_em > toda mensagem da janela) também não é atropelado.
  //   - `descartado` NUNCA reabre sozinho: descartar = "a IA errou aqui";
  //     reanálise repetiria o mesmo falso positivo e o operador o
  //     descartaria de novo a cada mensagem — a fadiga de alarme que a
  //     tela promete combater. Reabre só à mão (botão Reabrir).
  const ultimaDoCliente = [...comData]
    .reverse()
    .find((m) => m.sender_type === 'customer')
  if (ultimaDoCliente?.created_at) {
    const { error: estadoErr } = await admin
      .from('cb_conversation_insights')
      .update({ estado: 'aberto', estado_por: null, estado_em: null })
      .eq('id', args.insightId)
      .eq('estado', 'tratado')
      .lt('estado_em', ultimaDoCliente.created_at)
    if (estadoErr) {
      console.error('[radar] reset de estado não gravou:', estadoErr.message)
    }
  }

  return { semIa }
}

/**
 * Reanálise manual de UMA conversa (botão "Reanalisar agora"). Respeita o
 * opt-in por canal — reanálise manual não é licença para analisar canal
 * que o operador deixou desligado — mas ignora o throttle.
 * Lança Error com `motivo` tipado para a rota traduzir em HTTP.
 */
export async function reanalisarConversa(
  admin: SupabaseClient,
  args: { conversationId: string; accountId: string },
): Promise<{ semIa: boolean }> {
  const { data: conversa, error } = await admin
    .from('conversations')
    .select('id, account_id, channel_id, group_id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (error) throw new Error(`falha lendo a conversa: ${error.message}`)
  if (!conversa) throw new ErroDoRadar('conversa_nao_encontrada')
  if (conversa.group_id) throw new ErroDoRadar('grupo_fora_do_radar')
  if (!conversa.channel_id) throw new ErroDoRadar('conversa_sem_canal')

  const { data: canal } = await admin
    .from('cb_channels')
    .select('radar_enabled')
    .eq('id', conversa.channel_id)
    .maybeSingle()
  if (!canal?.radar_enabled) throw new ErroDoRadar('radar_desligado_no_canal')

  const { data: existente } = await admin
    .from('cb_conversation_insights')
    .select('id, conversation_id, status, janela_fim, analisado_em, tentativas')
    .eq('conversation_id', conversa.id)
    .maybeSingle()
  if (existente?.status === 'running') throw new ErroDoRadar('ja_em_analise')

  const reivindicado = await reivindicar(
    admin,
    {
      id: conversa.id,
      account_id: conversa.account_id,
      channel_id: conversa.channel_id,
      last_message_at: null,
    },
    (existente as InsightExistente | null) ?? undefined,
    { respeitarThrottle: false },
  )
  if (!reivindicado) throw new ErroDoRadar('ja_em_analise')

  try {
    return await analisarConversaReivindicada(admin, {
      insightId: reivindicado.id,
      claimIso: reivindicado.claimIso,
      conversationId: conversa.id,
      accountId: conversa.account_id,
      channelId: conversa.channel_id,
    })
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido'
    await marcarFalha(admin, reivindicado, motivo)
    throw err
  }
}

/** Erro de regra do Radar — a rota mapeia `motivo` para o HTTP certo. */
export class ErroDoRadar extends Error {
  readonly motivo:
    | 'conversa_nao_encontrada'
    | 'grupo_fora_do_radar'
    | 'conversa_sem_canal'
    | 'radar_desligado_no_canal'
    | 'ja_em_analise'
  constructor(motivo: ErroDoRadar['motivo']) {
    super(motivo)
    this.name = 'ErroDoRadar'
    this.motivo = motivo
  }
}
