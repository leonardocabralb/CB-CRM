// ============================================================
// Transcrição de nota de voz — a função ÚNICA, idempotente e guardada.
//
// Três chamadores, uma regra: o botão da bolha (rota), o worker do Radar
// (áudio do cliente na janela) e — no futuro — a resposta automática.
// Quem chega primeiro paga a transcrição; os demais leem o que já está
// gravado. O cadeado UPDATE…RETURNING é obrigatório: no deploy
// (`start-first`) existem DOIS processos vivos, e só o banco impede pagar
// duas vezes o mesmo áudio.
//
// Provedor: GEMINI, com a chave BYO da conta (decisão 2026-08-27 — o
// plano original previa ElevenLabs com chave da casa; com o Gemini no
// projeto, a mesma chave do Radar transcreve sem segredo novo na VPS).
// ⚠️ O PREÇO deixou de ser argumento nessa comparação: com o modelo
// abaixo estamos em ~US$ 0,24/h de áudio, ACIMA dos ~US$ 0,22/h do
// ElevenLabs Scribe — eram ~US$ 0,07/h no Flash-Lite, e é daí que vinha o
// "1/3 do preço" que esta linha afirmava. Quem reabrir a escolha de
// provedor decide por sigilo, qualidade ou latência, não por custo.
// O MODELO é fixado AQUI, separado do modelo de
// análise/chat da conta — e é UM para os dois chamadores, de propósito:
// não existe "transcrever de novo" (a idempotência devolve o texto
// gravado ANTES do cadeado, e a bolha troca o botão por um `<details>`
// quando já há texto), então modelo por chamador só decidiria quem ganha
// a corrida — sem deixar registro de qual escreveu o quê, e com o teto de
// tentativas compartilhado entre os dois. Avaliado e descartado em
// 2026-08-28; economia teto de R$ 4/mês.
//
// ⚠️ Sem chave Gemini NÃO se grava estado: devolvemos `recusada` sem
// tocar na linha, para o botão voltar a funcionar no instante em que a
// chave for cadastrada. Gravar `recusada` (terminal, sem botão) mataria
// o áudio para sempre por um problema de configuração passageiro.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import {
  geminiEndpoint,
  geminiText,
  geminiUsage,
  type GeminiResponse,
} from '@/lib/ai/providers/gemini'
import { logAiUsage } from '@/lib/ai/usage'

/**
 * Fixo de propósito — ver o cabeçalho. Trocar de modelo é trocar AQUI.
 *
 * `gemini-3.7-flash` desde 2026-08-28, escolhido por medição: 12 áudios
 * REAIS do acervo (12 conversas, 8min30, de 1,5s a 2min54), mesmo prompt,
 * temperatura 0, erro medido contra duas referências Pro de gerações
 * diferentes — que discordam ENTRE SI em 9,4%, o piso de ruído da medida:
 *
 *   gemini-3.5-transcribe   11,3%   R$ 3,49/mês   ← outra API; ver 🔭 abaixo
 *   gemini-3.7-flash        12,1%   R$ 5,45/mês   ← este
 *   gemini-3.1-flash-lite   13,5%   R$ 1,31/mês
 *   gemini-3.5-flash-lite   18,4%   R$ 1,25/mês   ← o anterior
 *   whisper-large-v3        18,9%   local, ~5 min por áudio de 30s na VPS
 *
 * ⚠️ O que já foi transcrito FICA como está — não há caminho de refazer,
 * nem pela tela nem por retentativa (ver o cabeçalho). `transcricao_em` é
 * o único discriminador entre o texto do modelo velho e o do novo; nenhuma
 * coluna guarda o modelo. Na troca eram poucas dezenas de áudios, todos de
 * teste, e ficaram.
 *
 * A média não é o que decide: em áudio ruim o Flash-Lite devolvia
 * português fluente e ERRADO — inverteu quem fazia o quê e inventou "para
 * os capa doce" — sem nenhum sinal de baixa confiança para o atendente
 * desconfiar. No volume real (~567 áudios/mês) a diferença de custo entre
 * o melhor e o pior é de R$ 4, então qualidade decide sozinha.
 *
 * ⚠️ NÃO desligar o raciocínio (`thinkingConfig.thinkingBudget: 0`). É
 * tentador — os tokens de "pensamento" são ~6× os da transcrição e cortam
 * a conta pela metade —, mas o erro sobe para 13,9%, o nível de um modelo
 * mais barato. Medido, não suposto.
 *
 * 🔭 CANDIDATO FUTURO — `gemini-3.5-transcribe` (especializado): mede
 * melhor, responde mais rápido (p50 1,9s) e custa menos. NÃO atende no
 * `generateContent`: devolve HTTP 200 com `parts: [{}]` vazio e cobra a
 * entrada. Ele vive na API de Interações:
 *
 *     POST https://generativelanguage.googleapis.com/v1beta/interactions
 *     { model, input: [{ type: 'audio', data: <base64>, mime_type }],
 *       generation_config: { transcription_config: { language_codes: ['pt-BR'] } } }
 *     → texto em steps[].content[].text
 *
 * Em 2026-08-28 ainda tinha duas arestas que o desqualificavam: o modo
 * `smart` APAGOU uma frase inteira de fala (usar `verbatim`, o padrão) e
 * `diarization_mode`/`timestamp_granularities` são aceitos sem erro mas
 * devolvem ZERO anotações — justamente os recursos que justificariam a
 * troca. Revisitar quando estabilizar: separar quem fala é algo que
 * nenhum outro modelo daqui faz. Adotá-lo é um segundo caminho de escrita
 * neste arquivo, com queda para o modelo acima quando a resposta vier
 * vazia — não uma troca de constante.
 */
export const MODELO_TRANSCRICAO = 'gemini-3.7-flash'
const TENTATIVAS_MAX = 3
const TRAVADA_MIN = 10
/** Nota de voz real tem centenas de KB; 15 MB já é playlist encaminhada. */
const TAMANHO_MAX_BYTES = 15 * 1024 * 1024
const MAX_TOKENS_TRANSCRICAO = 4096
/** Exportado: o worker do Radar soma isto à reserva de prazo antes de
 *  iniciar uma transcrição — sem somar, uma iniciada perto do teto do
 *  ciclo estourava o `curl -m` do agendador. */
export const TIMEOUT_DOWNLOAD_MS = 20_000
/** Espelho da janela da bolha (`JANELA_DOWNLOAD_MS`): o webhook grava a
 *  mensagem PRIMEIRO e o arquivo segundos depois. */
const JANELA_DOWNLOAD_MS = 2 * 60_000

const INSTRUCAO =
  'Transcreva o áudio a seguir fielmente, em português do Brasil. ' +
  'Responda APENAS com o texto transcrito, sem comentários, sem rótulos. ' +
  'Se o áudio estiver vazio ou ininteligível, responda exatamente: [inaudível]'

export type ResultadoTranscricao =
  | { status: 'pronta'; transcricao: string }
  | { status: 'transcrevendo' }
  | { status: 'falhou'; erro: string }
  | { status: 'recusada'; erro: string }

interface MensagemDeAudio {
  id: string
  conversation_id: string
  content_type: string
  content_text: string | null
  media_url: string | null
  media_type: string | null
  created_at: string | null
  deleted_at: string | null
  transcricao: string | null
  transcricao_status: string | null
  transcricao_erro: string | null
  transcricao_tentativas: number
  conversation: { account_id: string; channel_id: string | null } | null
}

export async function transcreverAudio(
  admin: SupabaseClient,
  args: { accountId: string; messageId: string },
): Promise<ResultadoTranscricao> {
  // Posse ANTES de qualquer coisa: `messages` não tem account_id, e o
  // service-role ignora RLS — a conta vem da conversa, e conta errada é
  // "não existe" (não vazar que a mensagem existe em outra conta).
  const { data, error } = await admin
    .from('messages')
    .select(
      'id, conversation_id, content_type, content_text, media_url, media_type, created_at, deleted_at, transcricao, transcricao_status, transcricao_erro, transcricao_tentativas, conversation:conversations!inner(account_id, channel_id)',
    )
    .eq('id', args.messageId)
    .maybeSingle()
  if (error) return { status: 'falhou', erro: `falha lendo a mensagem: ${error.message}` }

  const msg = data as unknown as MensagemDeAudio | null
  if (!msg || msg.conversation?.account_id !== args.accountId) {
    return { status: 'recusada', erro: 'mensagem não encontrada' }
  }
  if (msg.content_type !== 'audio') {
    return { status: 'recusada', erro: 'a mensagem não é um áudio' }
  }
  // ⚠️ Áudio apagado não se transcreve — a 929 tomou a decisão análoga
  // para a busca: achar conteúdo pelo que foi APAGADO é decisão jurídica,
  // não efeito colateral. Sem gravar nada.
  if (msg.deleted_at) {
    return { status: 'recusada', erro: 'a mensagem foi apagada' }
  }

  // Idempotência: quem chegar depois lê de graça.
  if (msg.transcricao) return { status: 'pronta', transcricao: msg.transcricao }
  if (msg.transcricao_status === 'recusada') {
    return { status: 'recusada', erro: msg.transcricao_erro ?? 'transcrição recusada' }
  }

  // ⚠️ No transporte Meta o media_url é o proxy RELATIVO
  // `/api/whatsapp/media/<id>`, que exige sessão de usuário — um caminho
  // server-side buscaria a tela de login e transcreveria lixo.
  if (!msg.media_url || !msg.media_url.startsWith('https://')) {
    // ⚠️ O webhook grava a mensagem PRIMEIRO e o arquivo segundos depois
    // (o Radar prioriza a conversa mais recente, então ele CHEGA nessa
    // janela). Recusar em definitivo aqui matava o áudio recém-chegado —
    // dentro da janela de download é transitório: nada é gravado.
    const idadeMs = msg.created_at
      ? Date.now() - Date.parse(msg.created_at)
      : Number.POSITIVE_INFINITY
    if (idadeMs < JANELA_DOWNLOAD_MS) {
      return { status: 'falhou', erro: 'o áudio ainda está sendo baixado — tente de novo em instantes' }
    }
    await gravarTerminal(admin, msg.id, 'recusada', 'áudio sem arquivo acessível ao servidor')
    return { status: 'recusada', erro: 'áudio sem arquivo acessível ao servidor' }
  }

  // Chave ANTES do cadeado (ver cabeçalho: sem chave não se grava estado).
  // ⚠️ Resolvida PELO CANAL da conversa, como a análise do Radar — sem o
  // canal, conta com padrão OpenAI e agente Gemini no canal recusava tudo,
  // e o INVERSO mandava o áudio ao Google num canal que o operador apontou
  // para outro provedor (revisão 2026-08-27). Grupo tem canal nulo e cai
  // no padrão da conta, como em todo o resto do projeto.
  const config = await loadAiConfig(admin, args.accountId, {
    requireActive: false,
    channelId: msg.conversation?.channel_id ?? null,
  })
  if (!config) {
    return { status: 'recusada', erro: 'sem chave de IA configurada — cadastre uma chave Gemini em Configurações → Assistente de IA' }
  }
  if (config.provider !== 'gemini') {
    return { status: 'recusada', erro: 'a transcrição usa o Gemini — o agente da conta está em outro provedor' }
  }

  // O CADEADO. Teto de tentativas DENTRO do WHERE (uma retentativa
  // concorrente não o fura) e recolhimento de travada embutido (10 min —
  // deploy no meio da transcrição não deixa "Transcrevendo…" eterno).
  const claimIso = new Date().toISOString()
  const corte = new Date(Date.now() - TRAVADA_MIN * 60_000).toISOString()
  const { data: claim, error: claimErr } = await admin
    .from('messages')
    .update({
      transcricao_status: 'transcrevendo',
      transcricao_desde: claimIso,
      transcricao_tentativas: msg.transcricao_tentativas + 1,
    })
    .eq('id', msg.id)
    .eq('content_type', 'audio')
    .is('deleted_at', null)
    .is('transcricao', null)
    .lt('transcricao_tentativas', TENTATIVAS_MAX)
    // O incremento é leitura-então-escrita: sem amarrar o valor LIDO, um
    // claim concorrente entre o SELECT do topo e este UPDATE faria o
    // contador regredir e o teto virar 4+ chamadas pagas.
    .eq('transcricao_tentativas', msg.transcricao_tentativas)
    .or(
      `transcricao_status.is.null,transcricao_status.eq.falhou,and(transcricao_status.eq.transcrevendo,transcricao_desde.lt.${corte})`,
    )
    .select('id')
    .maybeSingle()
  if (claimErr) return { status: 'falhou', erro: `falha no cadeado: ${claimErr.message}` }

  if (!claim) {
    // Alguém chegou antes — ou o teto esgotou. Devolver o estado REAL,
    // sem cobrar nada; esgotado vira `recusada` (terminal, sem botão).
    const { data: atualData } = await admin
      .from('messages')
      .select('transcricao, transcricao_status, transcricao_erro, transcricao_tentativas')
      .eq('id', msg.id)
      .maybeSingle()
    const atual = atualData as Pick<
      MensagemDeAudio,
      'transcricao' | 'transcricao_status' | 'transcricao_erro' | 'transcricao_tentativas'
    > | null
    if (atual?.transcricao) return { status: 'pronta', transcricao: atual.transcricao }
    if (atual?.transcricao_status === 'falhou' && (atual.transcricao_tentativas ?? 0) >= TENTATIVAS_MAX) {
      await gravarTerminal(admin, msg.id, 'recusada', 'tentativas esgotadas — o áudio não pôde ser transcrito')
      return { status: 'recusada', erro: 'tentativas esgotadas — o áudio não pôde ser transcrito' }
    }
    if (atual?.transcricao_status === 'recusada') {
      return { status: 'recusada', erro: atual.transcricao_erro ?? 'transcrição recusada' }
    }
    return { status: 'transcrevendo' }
  }

  try {
    // Download do bucket (público) com teto de tamanho e de tempo.
    const controle = new AbortController()
    const tDownload = setTimeout(() => controle.abort(), TIMEOUT_DOWNLOAD_MS)
    let bytes: Buffer
    let mimeDoStorage: string | null
    try {
      const resp = await fetch(msg.media_url, { signal: controle.signal })
      if (!resp.ok) {
        return await falhar(admin, msg.id, claimIso, `download do áudio falhou (HTTP ${resp.status})`)
      }
      mimeDoStorage = resp.headers.get('content-type')
      // O corpo fica DENTRO do timeout: só os headers dentro dele deixava
      // um body lento pendurar a chamada muito além dos 20s prometidos.
      bytes = Buffer.from(await resp.arrayBuffer())
    } finally {
      clearTimeout(tDownload)
    }
    if (bytes.byteLength > TAMANHO_MAX_BYTES) {
      await gravarTerminal(admin, msg.id, 'recusada', 'áudio grande demais para transcrever', claimIso)
      return { status: 'recusada', erro: 'áudio grande demais para transcrever' }
    }
    if (bytes.byteLength === 0) {
      return await falhar(admin, msg.id, claimIso, 'download do áudio veio vazio')
    }

    // O mime REAL: a 042 gravou o da entrada; o Storage devolve o salvo.
    // `audio/ogg` é o fallback honesto — 100% do acervo real é ogg/opus.
    const mime = msg.media_type || mimeDoStorage || 'audio/ogg'

    const tGemini = new AbortController()
    const tHandle = setTimeout(() => tGemini.abort(), aiRequestTimeoutMs())
    let r: Response
    try {
      r = await fetch(geminiEndpoint(MODELO_TRANSCRICAO), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // ⚠️ Header, nunca `?key=` na URL (vaza em log de proxy).
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: INSTRUCAO },
                { inlineData: { mimeType: mime, data: bytes.toString('base64') } },
              ],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS_TRANSCRICAO },
        }),
        signal: tGemini.signal,
      })
    } finally {
      clearTimeout(tHandle)
    }

    if (!r.ok) {
      const corpo = await r.text().catch(() => '')
      return await falhar(
        admin,
        msg.id,
        claimIso,
        `Gemini respondeu HTTP ${r.status}: ${corpo.slice(0, 200)}`,
      )
    }
    const dataGemini = (await r.json().catch(() => null)) as GeminiResponse | null

    // ⚠️ Custo registrado ANTES de julgar a resposta: um fim MAX_TOKENS ou
    // uma resposta vazia já foram COBRADOS na chave da conta (o áudio de
    // entrada é a parte cara), e `falhou` retenta até 3× — sem o log aqui,
    // exatamente o áudio mais caro sumia do painel de uso (mesmo princípio
    // gravado no worker do Radar).
    void logAiUsage(admin, {
      accountId: args.accountId,
      conversationId: msg.conversation_id,
      mode: 'transcricao',
      provider: 'gemini',
      model: MODELO_TRANSCRICAO,
      usage: geminiUsage(dataGemini),
    })

    const texto = geminiText(dataGemini).trim()
    const finish = dataGemini?.candidates?.[0]?.finishReason
    if (finish === 'MAX_TOKENS') {
      // Determinístico a temperatura 0: retentar é pagar o MESMO áudio de
      // novo pelo mesmo resultado — terminal, não `falhou`.
      await gravarTerminal(admin, msg.id, 'recusada', 'áudio longo demais para transcrever', claimIso)
      return { status: 'recusada', erro: 'áudio longo demais para transcrever' }
    }
    if (!texto) {
      return await falhar(admin, msg.id, claimIso, 'o modelo devolveu resposta vazia')
    }

    const { data: gravado } = await admin
      .from('messages')
      .update({
        transcricao: texto,
        transcricao_status: 'pronta',
        transcricao_em: new Date().toISOString(),
        transcricao_erro: null,
        transcricao_desde: null,
      })
      .eq('id', msg.id)
      // Cerca de posse (molde do Radar): se o recolhimento de 10 min nos
      // deu por mortos e outro processo assumiu, este resultado é o mais
      // velho — vira no-op, mas o texto ainda serve ao chamador.
      .eq('transcricao_status', 'transcrevendo')
      .eq('transcricao_desde', claimIso)
      .select('id')
      .maybeSingle()
    if (!gravado) {
      console.warn(`[transcricao] resultado da mensagem ${msg.id} descartado: reivindicada por outro processo`)
    }
    return { status: 'pronta', transcricao: texto }
  } catch (err) {
    const motivo =
      err instanceof Error && err.name === 'AbortError'
        ? 'tempo esgotado'
        : err instanceof Error
          ? err.message
          : 'erro desconhecido'
    return await falhar(admin, msg.id, claimIso, motivo)
  }
}

/** Falha retentável — grava `falhou` com a cerca de posse e devolve. */
async function falhar(
  admin: SupabaseClient,
  messageId: string,
  claimIso: string,
  motivo: string,
): Promise<ResultadoTranscricao> {
  const { error } = await admin
    .from('messages')
    .update({
      transcricao_status: 'falhou',
      transcricao_erro: motivo.slice(0, 300),
      transcricao_desde: null,
    })
    .eq('id', messageId)
    .eq('transcricao_status', 'transcrevendo')
    .eq('transcricao_desde', claimIso)
  if (error) {
    console.error(`[transcricao] não gravou a falha da mensagem ${messageId}:`, error.message)
  }
  return { status: 'falhou', erro: motivo }
}

/** Estado terminal (`recusada`) — com cerca quando veio de um claim nosso,
 *  sem cerca quando é decisão prévia (URL relativa, teto esgotado). */
async function gravarTerminal(
  admin: SupabaseClient,
  messageId: string,
  status: 'recusada',
  motivo: string,
  claimIso?: string,
): Promise<void> {
  let query = admin
    .from('messages')
    .update({
      transcricao_status: status,
      transcricao_erro: motivo.slice(0, 300),
      transcricao_desde: null,
    })
    .eq('id', messageId)
    .is('transcricao', null)
  if (claimIso) {
    query = query.eq('transcricao_desde', claimIso)
  }
  const { error } = await query
  if (error) {
    console.error(`[transcricao] não gravou recusa da mensagem ${messageId}:`, error.message)
  }
}
