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
//   - lote pequeno e parada antecipada por tempo (cada conversa é UMA
//     chamada de rede a um LLM com timeout de 30s — 5 já enche o
//     maxDuration de 60s da rota).
//
// Diferença deliberada: aqui retentar é SEGURO (nada sai para o
// cliente), então falha vira `failed` + `tentativas`, sem análogo de
// `entrega_incerta`.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { generateStructured } from '@/lib/ai/structured'
import { logAiUsage } from '@/lib/ai/usage'
import type { AiUsage } from '@/lib/ai/types'
import { calcularMetricas, type MensagemParaMetricas } from './metricas'
import { extrairNumerosDeProcesso } from './processos'
import {
  RADAR_SCHEMA,
  interpretarAnalise,
  montarPromptDoRadar,
  montarTranscrito,
  type AnaliseInterpretada,
  type MensagemParaTranscrito,
} from './rubrica'

export const JANELA_DIAS = 7
/** Conversas por ciclo. Bem abaixo dos 20 das agendadas: lá cada item é
 *  um POST à Evolution; aqui é uma geração de LLM. */
const POR_CICLO = 5
/** Não reanalisar a mesma conversa antes disso, mesmo com mensagem nova —
 *  o laço lento do agendador bate a cada 15min e sem isso toda conversa
 *  ativa seria reanalisada 4x/hora. */
const THROTTLE_MS = 30 * 60_000
/** `running` mais velho que isto é worker que morreu no meio. Acima do
 *  pior caso de uma análise (timeout de 30s + escritas). */
const TRAVADA_MIN = 10
const TENTATIVAS_MAX = 3
/** Orçamento padrão do ciclo — folga sob o `maxDuration = 60` da rota. */
const TEMPO_LIMITE_MS = 45_000
const MAX_TOKENS_RADAR = 2048
const TETO_MENSAGENS_JANELA = 1000

export interface ResultadoDoCiclo {
  candidatas: number
  analisadas: number
  falhas: number
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
    if (Date.now() - inicioCiclo > tempoLimiteMs) break
    const existente = porConversa.get(conversa.id)
    const reivindicado = await reivindicar(admin, conversa, existente)
    if (!reivindicado) continue

    try {
      await analisarConversaReivindicada(admin, {
        insightId: reivindicado.id,
        conversationId: conversa.id,
        accountId: conversa.account_id,
        channelId: conversa.channel_id,
      })
      resultado.analisadas += 1
    } catch (err) {
      resultado.falhas += 1
      const motivo = err instanceof Error ? err.message : 'erro desconhecido'
      console.error(`[radar] análise da conversa ${conversa.id} falhou:`, motivo)
      await admin
        .from('cb_conversation_insights')
        .update({
          status: 'failed',
          erro: motivo.slice(0, 500),
          tentativas: (existente?.tentativas ?? 0) + 1,
          running_desde: null,
        })
        .eq('id', reivindicado.id)
    }
  }

  return resultado
}

function precisaDeAnalise(
  conversa: ConversaCandidata,
  insight: InsightExistente | undefined,
  agoraMs: number,
): boolean {
  if (!insight) return true
  if (insight.status === 'running') return false

  const temMsgNova =
    !insight.janela_fim ||
    (conversa.last_message_at !== null &&
      conversa.last_message_at > insight.janela_fim)

  if (insight.status === 'failed') {
    // Retentável até o teto; mensagem nova zera a conversa de qualquer
    // teto — o conteúdo mudou, a falha antiga não conta mais a história.
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
    .lt('running_desde', corte)
  if (error || !presas || presas.length === 0) return 0

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
    if (!upErr) recolhidas += 1
  }
  return recolhidas
}

async function reivindicar(
  admin: SupabaseClient,
  conversa: ConversaCandidata,
  existente: InsightExistente | undefined,
): Promise<{ id: string } | null> {
  const agora = new Date().toISOString()
  if (existente) {
    const { data } = await admin
      .from('cb_conversation_insights')
      .update({ status: 'running', running_desde: agora })
      .eq('id', existente.id)
      .neq('status', 'running')
      .select('id')
      .maybeSingle()
    return data ?? null
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
        running_desde: agora,
      },
      { onConflict: 'conversation_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle()
  return data ?? null
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
 * Sem IA configurada a análise NÃO falha: grava as métricas
 * determinísticas e os processos por regex — o painel funciona no dia 1,
 * sem chave, e diz o que falta.
 */
export async function analisarConversaReivindicada(
  admin: SupabaseClient,
  args: {
    insightId: string
    conversationId: string
    accountId: string
    channelId: string | null
  },
): Promise<{ semIa: boolean }> {
  const janelaFim = new Date()
  const janelaInicio = new Date(janelaFim.getTime() - JANELA_DIAS * 86_400_000)

  const { data: mensagens, error: msgErr } = await admin
    .from('messages')
    .select('id, sender_type, content_type, content_text, created_at')
    .eq('conversation_id', args.conversationId)
    .gte('created_at', janelaInicio.toISOString())
    .is('deleted_at', null)
    .neq('content_type', 'system')
    .order('created_at', { ascending: true })
    .limit(TETO_MENSAGENS_JANELA)
  if (msgErr) throw new Error(`falha lendo mensagens: ${msgErr.message}`)

  const linhas = (mensagens ?? []) as MensagemDaJanela[]
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

  // Agente do canal com queda para o padrão da conta — a MESMA semântica
  // do auto-reply (loadAiConfig resolve; ver 903).
  const config = await loadAiConfig(admin, args.accountId, {
    requireActive: true,
    channelId: args.channelId,
  })

  let analise: AnaliseInterpretada | null = null
  let usage: AiUsage | null = null
  const temIa = config !== null && transcrito.linhas.length > 0
  if (config && temIa) {
    const { systemPrompt, userContent } = montarPromptDoRadar({
      transcrito,
      metricas,
      mensagensSemTexto: semTexto,
      processosPorRegex,
    })
    const resposta = await generateStructured({
      config,
      systemPrompt,
      userContent,
      schema: RADAR_SCHEMA,
      maxOutputTokens: MAX_TOKENS_RADAR,
    })
    usage = resposta.usage
    analise = interpretarAnalise(resposta.object, transcrito.linhas)
    if (!analise) {
      throw new Error('a IA respondeu num formato que não é um objeto de análise')
    }
    void logAiUsage(admin, {
      accountId: args.accountId,
      conversationId: args.conversationId,
      mode: 'radar',
      channelId: args.channelId,
      provider: config.provider,
      model: config.model,
      usage,
    })
  }

  const ultima = comData[comData.length - 1]
  const { error: upErr } = await admin
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
        sem_ia: !temIa,
        processos: processosPorRegex,
        analise,
      },

      primeira_resposta_seg: metricas.primeiraRespostaSeg,
      resposta_mediana_seg: metricas.respostaMedianaSeg,
      aguardando_desde: metricas.aguardandoDesde?.toISOString() ?? null,

      // Reanálise volta para 'aberto': houve mensagem nova, a situação
      // mudou e o "tratado" anterior não vale mais.
      estado: 'aberto',
      estado_por: null,
      estado_em: null,

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
  if (upErr) throw new Error(`falha gravando o insight: ${upErr.message}`)

  return { semIa: !temIa }
}

/**
 * Reanálise manual de UMA conversa (botão "Reanalisar agora"). Respeita o
 * opt-in por canal — reanálise manual não é licença para analisar canal
 * que o operador deixou desligado — mas ignora o throttle de 30min.
 * Lança Error com `code` simples para a rota traduzir em HTTP.
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
  )
  if (!reivindicado) throw new ErroDoRadar('ja_em_analise')

  try {
    return await analisarConversaReivindicada(admin, {
      insightId: reivindicado.id,
      conversationId: conversa.id,
      accountId: conversa.account_id,
      channelId: conversa.channel_id,
    })
  } catch (err) {
    const motivo = err instanceof Error ? err.message : 'erro desconhecido'
    await admin
      .from('cb_conversation_insights')
      .update({
        status: 'failed',
        erro: motivo.slice(0, 500),
        tentativas: ((existente as InsightExistente | null)?.tentativas ?? 0) + 1,
        running_desde: null,
      })
      .eq('id', reivindicado.id)
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
