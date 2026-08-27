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
// projeto, a mesma chave do Radar transcreve por ~1/3 do preço e sem
// segredo novo na VPS). O MODELO é fixado AQUI, separado do modelo de
// análise/chat da conta: transcrever não precisa de raciocínio, e o
// Flash-Lite custa ~metade do Flash.
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

/** Fixo de propósito — ver o cabeçalho. Trocar de modelo é trocar aqui. */
export const MODELO_TRANSCRICAO = 'gemini-3.5-flash-lite'
const TENTATIVAS_MAX = 3
const TRAVADA_MIN = 10
/** Nota de voz real tem centenas de KB; 15 MB já é playlist encaminhada. */
const TAMANHO_MAX_BYTES = 15 * 1024 * 1024
const MAX_TOKENS_TRANSCRICAO = 4096
const TIMEOUT_DOWNLOAD_MS = 20_000

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
  deleted_at: string | null
  transcricao: string | null
  transcricao_status: string | null
  transcricao_erro: string | null
  transcricao_tentativas: number
  conversation: { account_id: string } | null
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
      'id, conversation_id, content_type, content_text, media_url, media_type, deleted_at, transcricao, transcricao_status, transcricao_erro, transcricao_tentativas, conversation:conversations!inner(account_id)',
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
    await gravarTerminal(admin, msg.id, 'recusada', 'áudio sem arquivo acessível ao servidor')
    return { status: 'recusada', erro: 'áudio sem arquivo acessível ao servidor' }
  }

  // Chave ANTES do cadeado (ver cabeçalho: sem chave não se grava estado).
  const config = await loadAiConfig(admin, args.accountId, { requireActive: false })
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
    let resp: Response
    try {
      resp = await fetch(msg.media_url, { signal: controle.signal })
    } finally {
      clearTimeout(tDownload)
    }
    if (!resp.ok) {
      return await falhar(admin, msg.id, claimIso, `download do áudio falhou (HTTP ${resp.status})`)
    }
    const bytes = Buffer.from(await resp.arrayBuffer())
    if (bytes.byteLength > TAMANHO_MAX_BYTES) {
      await gravarTerminal(admin, msg.id, 'recusada', 'áudio grande demais para transcrever', claimIso)
      return { status: 'recusada', erro: 'áudio grande demais para transcrever' }
    }
    if (bytes.byteLength === 0) {
      return await falhar(admin, msg.id, claimIso, 'download do áudio veio vazio')
    }

    // O mime REAL: a 042 gravou o da entrada; o Storage devolve o salvo.
    // `audio/ogg` é o fallback honesto — 100% do acervo real é ogg/opus.
    const mime =
      msg.media_type || resp.headers.get('content-type') || 'audio/ogg'

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
    const texto = geminiText(dataGemini).trim()
    const finish = dataGemini?.candidates?.[0]?.finishReason
    if (finish === 'MAX_TOKENS') {
      return await falhar(admin, msg.id, claimIso, 'transcrição cortada por tamanho — áudio longo demais')
    }
    if (!texto) {
      return await falhar(admin, msg.id, claimIso, 'o modelo devolveu resposta vazia')
    }

    // Custo registrado na chave da conta, como todo modo de IA.
    const usage = geminiUsage(dataGemini)
    void logAiUsage(admin, {
      accountId: args.accountId,
      conversationId: msg.conversation_id,
      mode: 'transcricao',
      provider: 'gemini',
      model: MODELO_TRANSCRICAO,
      usage,
    })

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
