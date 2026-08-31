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
import { nomeDePessoa } from '@/lib/assinatura/assinatura'
import { loadAiConfig } from '@/lib/ai/config'
import { generateStructured } from '@/lib/ai/structured'
import { logAiUsage } from '@/lib/ai/usage'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import type { AiUsage } from '@/lib/ai/types'
import { TIMEOUT_DOWNLOAD_MS, transcreverAudio } from '@/lib/transcricao/transcrever'
import { calcularMetricas, type MensagemParaMetricas } from './metricas'
import { JANELA_DIAS, THROTTLE_MS } from './ordenacao'
import { extrairNumerosDeProcesso } from './processos'
import {
  PREFIXO_AUDIO,
  RADAR_SCHEMA,
  interpretarAnalise,
  montarPromptDoRadar,
  montarTranscrito,
  type AnaliseInterpretada,
  type MensagemParaTranscrito,
} from './rubrica'

export { JANELA_DIAS, THROTTLE_MS }
/** Conversas por ciclo. Bem abaixo dos 20 das agendadas: lá cada item é
 *  um POST à Evolution; aqui é uma geração de LLM. */
const POR_CICLO = 5
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
/** Áudios do cliente transcritos por ANÁLISE (novos; os prontos são
 *  leitura grátis). Teto de custo e de tempo — o que passar fica como
 *  lacuna declarada e entra na próxima análise. */
const TRANSCRICOES_POR_ANALISE = 5

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
        deadlineMs: inicioCiclo + TETO_ABSOLUTO_MS,
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
  sender_id: string | null
  /** Saiu do celular pareado — gente digitando, sem usuário do CRM atrás. */
  from_device: boolean | null
  content_type: string
  content_text: string | null
  transcricao: string | null
  transcricao_status: string | null
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
    /** Instante-limite ABSOLUTO do chamador (o ciclo passa o teto do
     *  curl do agendador). As transcrições de áudio respeitam este
     *  orçamento, reservando o tempo da análise que ainda vem. */
    deadlineMs?: number
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
    .select(
      'id, sender_type, sender_id, from_device, content_type, content_text, transcricao, transcricao_status, created_at',
    )
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

  // ⚠️ A mensagem nascida de uma AGENDADA carrega `sender_id` — o
  // `dispatch.ts` passa `created_by` e o send-message o persiste. É
  // atribuição de quem AGENDOU, dias antes, não gente respondendo agora:
  // pela coluna sozinha, uma agendada de follow-up fechava a pendência do
  // cliente esquecido (achado do Codex no PR #74). A proveniência que a
  // distingue é `cb_scheduled_messages.message_id`, gravado no envio.
  //
  // ⚠️ Recortada pelos IDs das mensagens da JANELA (achado #05 do plano de
  // 31/08): pedir todas as agendadas da conversa encosta no teto de 1000 do
  // PostgREST numa conversa com anos de follow-up — truncagem sem `order`,
  // sem erro, e uma agendada de fora passando por resposta humana. Pelo
  // `.in`, a pergunta é exata e limitada por TETO_MENSAGENS_JANELA por
  // construção.
  const idsDaEquipe = comData
    .filter((m) => m.sender_type === 'agent')
    .map((m) => m.id)
  const { data: enviosAgendados, error: agErr } = idsDaEquipe.length
    ? await admin
        .from('cb_scheduled_messages')
        .select('message_id')
        .in('message_id', idsDaEquipe)
    : { data: [], error: null }
  // ⚠️ O throw é DELIBERADO, e a DIREÇÃO do erro é o motivo (M23 do plano):
  // sem esta consulta não há como distinguir agendada de resposta humana, e
  // degradar "sem a exclusão" — como o hook do painel faz — apagaria a
  // pendência do cliente esquecido de forma DURÁVEL, gravada no insight até
  // a próxima mensagem. Falhar preserva a análise congelada (o alarme fica
  // na tela), custa 1 das 3 tentativas e o ciclo seguinte retenta sozinho;
  // três seguidas viram `failed` VISÍVEL no painel, com o Reanalisar. O
  // hook pode degradar porque a leitura dele é efêmera (recarrega em 2
  // min); aqui é estado escrito.
  if (agErr) throw new Error(`falha lendo envios agendados: ${agErr.message}`)
  const deAgendada = new Set(
    (enviosAgendados ?? []).map((r) => r.message_id as string),
  )

  const metricas = calcularMetricas(
    comData.map(
      (m): MensagemParaMetricas => ({
        senderType: m.sender_type,
        // ⚠️ A régua do PAINEL, e não a de `houveHumanoNaJanela` logo abaixo:
        // aqui a pergunta é "alguém RESPONDEU a este cliente?", e o celular
        // pareado responde (`from_device`, `sender_id` nulo). Lá a pergunta é
        // outra — "vale preservar a análise congelada?" — e fica
        // DELIBERADAMENTE sem o alargamento do `from_device` (uma saída
        // solta pelo celular não é motivo para refazer análise). ⚠️ Já a
        // exclusão da AGENDADA vale para as DUAS réguas (#21 do plano de
        // 31/08): ela ESTREITA "humano", e sem ela lá embaixo o follow-up
        // agendado zerava o alarme do cliente esquecido. Não unificar as
        // duas expressões sem responder às duas perguntas.
        porGente:
          (m.sender_id !== null || m.from_device === true) &&
          !deAgendada.has(m.id),
        createdAt: new Date(m.created_at as string),
      }),
    ),
  )

  // Áudio do CLIENTE vira texto ANTES do transcrito, pela MESMA função
  // idempotente do botão da bolha: quem já foi transcrito é leitura
  // grátis; o novo paga UMA vez e serve a todas as análises futuras. Só
  // cliente — é a fala dele que decide pedido/urgência/nota; áudio da
  // equipe segue como lacuna declarada. Best-effort com teto duplo
  // (quantidade + prazo): transcrição indisponível NÃO derruba a análise,
  // o áudio só continua contando como "fora do transcrito".
  const deadlineMs = args.deadlineMs ?? Date.now() + TETO_ABSOLUTO_MS
  const transcricoes = new Map<string, string>()
  for (const m of comData) {
    if (m.transcricao) transcricoes.set(m.id, m.transcricao)
  }
  // ⚠️ Só áudio NUNCA tentado (`status` nulo). Retentar `falhou`
  // automaticamente a cada ciclo queimava o teto de 3 tentativas em ~45
  // min — uma cota estourada no provedor carimbava `recusada` TERMINAL em
  // todo áudio pendente antes de a cota voltar. Falha fica para o botão
  // humano da bolha, que retenta com julgamento.
  const audiosPendentes = comData.filter(
    (m) =>
      m.content_type === 'audio' &&
      m.sender_type === 'customer' &&
      !m.transcricao &&
      m.transcricao_status === null,
  )
  let tentativasDeAudio = 0
  for (const m of audiosPendentes) {
    if (tentativasDeAudio >= TRANSCRICOES_POR_ANALISE) break
    // Reserva o tempo DESTA transcrição (download + geração) + o da
    // análise que ainda vem.
    if (Date.now() + TIMEOUT_DOWNLOAD_MS + aiRequestTimeoutMs() * 2 > deadlineMs) break
    tentativasDeAudio += 1
    const r = await transcreverAudio(admin, {
      accountId: args.accountId,
      messageId: m.id,
    })
    if (r.status === 'pronta') transcricoes.set(m.id, r.transcricao)
  }

  // O texto que o transcrito vê: o que o cliente ESCREVEU, ou — para
  // áudio transcrito — o que ele DISSE, com o PREFIXO_AUDIO da rubrica
  // (é o contrato que dá à linha o teto maior de caracteres e diz ao
  // modelo e à evidência a origem).
  const textoDe = (m: MensagemDaJanela): string | null => {
    if (m.content_text && m.content_text.trim()) return m.content_text
    const t = transcricoes.get(m.id)
    return t ? `${PREFIXO_AUDIO}${t}` : null
  }
  const comTexto = comData.filter((m) => textoDe(m) !== null)
  const semTexto = comData.length - comTexto.length

  // Quem da equipe falou, por nome — o transcrito rotula "Equipe (Ana)" e
  // a análise pode observar o atendimento POR PESSOA (feedback de equipe).
  // Falha ABERTA: sem nome resolvido a linha volta ao rótulo genérico
  // "Equipe", e o prompt instrui a só avaliar atendente NOMEADO — perder
  // o feedback é aceitável, derrubar a análise por causa dele não.
  const idsDeAtendentes = [
    ...new Set(
      comTexto
        .filter((m) => m.sender_type === 'agent' && m.sender_id)
        .map((m) => m.sender_id as string),
    ),
  ]
  const nomePorAtendente = new Map<string, string>()
  if (idsDeAtendentes.length > 0) {
    const { data: perfis, error: perfisErr } = await admin
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', idsDeAtendentes)
    if (perfisErr) {
      console.warn('[radar] não resolveu nomes de atendentes:', perfisErr.message)
    }
    for (const p of perfis ?? []) {
      const nome = nomeDePessoa(
        p.full_name as string | null,
        p.email as string | null,
      )
      if (nome) nomePorAtendente.set(p.user_id as string, nome)
    }
  }

  const transcrito = montarTranscrito(
    comTexto.map(
      (m): MensagemParaTranscrito => ({
        id: m.id,
        senderType: m.sender_type,
        autor:
          m.sender_type === 'agent' && m.sender_id
            ? (nomePorAtendente.get(m.sender_id) ?? null)
            : null,
        createdAt: new Date(m.created_at as string),
        texto: textoDe(m) as string,
      }),
    ),
  )
  const processosPorRegex = extrairNumerosDeProcesso(
    comTexto.map((m) => textoDe(m)).join('\n'),
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

  // ⚠️ Janela em que o cliente NÃO falou (broadcast, abordagem ativa da
  // equipe, follow-up sem resposta): não há atendimento a julgar — nota,
  // pedido, insatisfação e urgência pressupõem fala do cliente. Pular a
  // IA aqui é o que impede um broadcast de disparar dezenas de análises
  // pagas de conversas onde só nós falamos: o ENVIO também atualiza
  // `conversations.last_message_at` (send-message.ts), então cada saída
  // torna a conversa candidata de novo. As métricas continuam gravadas.
  const semClienteNaJanela = metricas.msgsCliente === 0

  let analise: AnaliseInterpretada | null = null
  let usage: AiUsage | null = null
  // ⚠️ O MODELO DO RADAR (946), derivado UMA vez — a chamada, o log de uso
  // e a coluna do insight leem daqui. Uma segunda derivação solta é como o
  // custo acaba atribuído ao modelo errado. `let` anulável + atribuição
  // dentro do bloco, no molde de `analise`/`usage`: o fluxo do TS o
  // estreita para `string` nos usos internos.
  let modeloDoRadar: string | null = null
  if (config && transcrito.linhas.length > 0 && !semClienteNaJanela) {
    modeloDoRadar = config.radarModel ?? config.model
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
      model: modeloDoRadar,
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
      model: modeloDoRadar,
      usage,
    })
    // ⚠️ O relógio DA ANÁLISE ancora o corte de recência da insatisfação —
    // ver `interpretarAnalise`. Com a âncora na última linha do transcrito,
    // conversa que morre depois da reclamação nunca expirava o sinal.
    analise = interpretarAnalise(resposta.object, transcrito.linhas, Date.now())
    if (!analise) {
      throw new Error('a IA respondeu num formato que não é um objeto de análise')
    }
  }

  const semIa = config === null

  // ⚠️ Saída AUTOMÁTICA não fecha pendência (revisão 2026-08-27, dois
  // ângulos): broadcast, agendada, automação e fluxo também atualizam
  // `last_message_at`, então uma pendência congelada (cliente esquecido
  // além da janela) voltava à candidatura e o UPDATE completo zerava
  // `aguardando_desde` — o alarme sumia sem nenhum humano ter respondido.
  // O discriminador é `sender_id` (broadcast/automação/API mandam com ele
  // nulo, e fluxo é `bot`) MAIS a exclusão por proveniência: a AGENDADA sai
  // COM `sender_id` — o de quem a criou, dias antes — e era o furo que
  // restava (#21 do plano de 31/08): o follow-up agendado disparando sobre
  // a pendência congelada fazia esta régua dizer "houve humano", o ramo
  // preservador era pulado e o UPDATE completo zerava o alarme, sem
  // ninguém ter respondido.
  // Quando a janela só tem máquina (nenhum cliente, nenhum humano) e a
  // linha JÁ completou uma análise, esta análise é um NO-OP: avança só a
  // marca d'água (`janela_fim`) e preserva a análise congelada inteira —
  // que é exatamente o que o painel promete exibir. Resposta HUMANA na
  // janela segue fechando a pendência pelo UPDATE completo abaixo.
  const houveHumanoNaJanela = comData.some(
    (m) =>
      m.sender_type === 'agent' && m.sender_id !== null && !deAgendada.has(m.id),
  )
  if (semClienteNaJanela && !houveHumanoNaJanela) {
    const { data: preservado, error: presErr } = await admin
      .from('cb_conversation_insights')
      .update({
        janela_fim: janelaFim.toISOString(),
        status: 'done',
        running_desde: null,
        erro: null,
        tentativas: 0,
      })
      .eq('id', args.insightId)
      .eq('status', 'running')
      .eq('running_desde', args.claimIso)
      // Só preserva quem TEM análise completa a preservar — linha nova
      // (primeiro contato foi um broadcast) cai no UPDATE completo.
      .not('janela_fim', 'is', null)
      .select('id')
      .maybeSingle()
    if (presErr) throw new Error(`falha preservando o insight: ${presErr.message}`)
    if (preservado) return { semIa }
  }

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
        // A tela explica por que a linha não tem nota nem sinais — sem o
        // selo, "broadcast ontem" e "análise quebrada" pintam igual.
        sem_cliente_na_janela: semClienteNaJanela,
        // Cobre os DOIS cortes: o teto de 1000 linhas da leitura do banco
        // e o teto de 200 mensagens/60k chars do transcrito — em ambos, a
        // análise não viu a janela inteira e a tela tem de dizer isso.
        // (Repetição de robô colapsada NÃO conta: conteúdo idêntico já
        // visto não é lacuna.)
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

      // Carimbados só quando a IA RODOU (`analise` não-nula ⟺ o bloco da
      // chamada executou e parseou): com o pulo de "só equipe" ou com
      // transcrito vazio, gravar o provider afirmaria uma análise que não
      // aconteceu.
      provider: analise ? (config?.provider ?? null) : null,
      // O modelo do Radar (946), não o do agente de conversa — a MESMA
      // derivação da chamada e do log, nunca uma segunda expressão solta.
      model: analise ? modeloDoRadar : null,
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
      deadlineMs: Date.now() + TETO_ABSOLUTO_MS,
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
