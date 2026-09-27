// ============================================================
// Os LEITORES por provedor: a leitura de IMAGEM e PDF (`ler-midia.ts`) e a
// queda da transcrição de áudio para a OpenAI (`transcrever.ts`).
//
// PURO (testado): monta o pedido HTTP e lê a resposta de cada provedor. Quem
// baixa o arquivo, chama e grava é o módulo de I/O.
//
// ⚠️ Cada forma foi CONFERIDA na documentação oficial em 27/09/2026 — não de
// memória. As URLs estão ao lado de cada uma. Quem trocar um modelo ou um
// endpoint confere de novo lá, e muda o teste (que escreve os literais à mão
// de propósito: comparar o código com a própria constante é tautologia).
//
// A ordem de escolha é pela CHAVE que a conta tem (`escolher-leitor.ts`):
//   - imagem e PDF: Gemini → OpenAI → Anthropic;
//   - áudio: Gemini → OpenAI. A Anthropic NÃO tem entrada de áudio.
// O modelo de cada provedor é FIXO aqui (como `MODELO_TRANSCRICAO`), nunca
// configurável na tela: é o mesmo raciocínio do cabeçalho de `transcrever.ts`
// (não existe "ler de novo"; o primeiro que lê fixa o texto).
// ============================================================

import { ANTHROPIC_URL, ANTHROPIC_VERSION } from '@/lib/ai/providers/anthropic'
import { geminiEndpoint, geminiText, geminiUsage, type GeminiResponse } from '@/lib/ai/providers/gemini'
import { normalizeUsage } from '@/lib/ai/providers/shared'
import type { AiProvider, AiUsage } from '@/lib/ai/types'

/** A ordem da leitura de imagem e PDF: a primeira chave que a conta tiver. */
export const ORDEM_DA_LEITURA: readonly AiProvider[] = ['gemini', 'openai', 'anthropic']
/** A ordem da transcrição de áudio. Sem a Anthropic: ela não recebe áudio. */
export const ORDEM_DA_TRANSCRICAO: readonly AiProvider[] = ['gemini', 'openai']

/**
 * O modelo que LÊ imagem e PDF, por provedor. Fixo de propósito.
 *
 * - Gemini: o MESMO da transcrição (`MODELO_TRANSCRICAO`, escolhido por
 *   medição em 28/08) — lê imagem e PDF pelo mesmo `generateContent`.
 * - OpenAI: `gpt-5.4-mini`, o padrão do projeto, está na lista de modelos com
 *   visão (https://developers.openai.com/api/docs/guides/images-vision) e o PDF
 *   exige modelo com visão ("gpt-4o and later",
 *   https://developers.openai.com/api/docs/guides/pdf-files).
 * - Anthropic: `claude-sonnet-5` — "All active models support PDF processing"
 *   (https://platform.claude.com/docs/en/build-with-claude/pdf-support). NÃO o
 *   Haiku 4.5: a aposentadoria dele é "not sooner than October 15, 2026"
 *   (https://platform.claude.com/docs/en/about-claude/models/overview), e um
 *   modelo fixo que some vira `falhou` em toda leitura sem ninguém ver.
 */
export const MODELO_DE_LEITURA: Record<AiProvider, string> = {
  gemini: 'gemini-3.7-flash',
  openai: 'gpt-5.4-mini',
  anthropic: 'claude-sonnet-5',
}

/**
 * O modelo de transcrição da OpenAI, a queda quando a conta não tem chave do
 * Gemini. `gpt-transcribe` é o recomendado, e a referência lista `ogg` entre
 * os formatos aceitos ("flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, or webm",
 * https://developers.openai.com/api/reference/python/resources/audio/subresources/transcriptions/methods/create).
 * ⚠️ O guia (speech-to-text) omite o `ogg` da lista dele; quem decide é a
 * referência da API. 100% das notas de voz do acervo são ogg/opus.
 */
export const MODELO_TRANSCRICAO_OPENAI = 'gpt-transcribe'

export const URL_DA_OPENAI_RESPONSES = 'https://api.openai.com/v1/responses'
export const URL_DA_OPENAI_TRANSCRICAO = 'https://api.openai.com/v1/audio/transcriptions'

export type TipoDeLeitura = 'imagem' | 'pdf'

// ------------------------------------------------------------
// Tipos de arquivo
// ------------------------------------------------------------

/**
 * As imagens que CADA provedor lê:
 * - Gemini: "PNG, JPEG, WEBP, HEIC, HEIF"
 *   (https://ai.google.dev/gemini-api/docs/image-understanding);
 * - OpenAI: "PNG, JPEG, WEBP, and non-animated GIF" (images-vision);
 * - Anthropic: "image/jpeg, image/png, image/gif, image/webp" (vision).
 * PDF os três leem.
 */
const IMAGENS_POR_PROVEDOR: Record<AiProvider, readonly string[]> = {
  gemini: ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'],
  openai: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  anthropic: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
}
const IMAGENS_QUE_ALGUEM_LE = new Set(Object.values(IMAGENS_POR_PROVEDOR).flat())
export const MIME_DO_PDF = 'application/pdf'

const MIME_POR_EXTENSAO: Record<string, string> = {
  pdf: MIME_DO_PDF,
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
}

/** `IMAGE/JPEG; charset=binary` → `image/jpeg`; `image/jpg` (não padrão) → `image/jpeg`. */
export function mimeLimpo(mime: string | null | undefined): string | null {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase()
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream') return null
  return m === 'image/jpg' ? 'image/jpeg' : m
}

/** A extensão do nome (ou do último pedaço da URL), sem ponto e em minúsculas. */
export function extensao(nome: string | null | undefined): string | null {
  const base = (nome ?? '').split(/[?#]/)[0].split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  if (i <= 0 || i === base.length - 1) return null
  return base.slice(i + 1).toLowerCase()
}

export function mimeDaExtensao(ext: string | null): string | null {
  return ext ? (MIME_POR_EXTENSAO[ext] ?? null) : null
}

/** O mime é lido por ALGUM provedor? `null` = nenhum lê (docx, xlsx, zip, bmp…). */
export function tipoDoMime(mime: string | null): TipoDeLeitura | null {
  if (!mime) return null
  if (mime === MIME_DO_PDF) return 'pdf'
  return IMAGENS_QUE_ALGUEM_LE.has(mime) ? 'imagem' : null
}

/** ESTE provedor lê este arquivo? (HEIC só o Gemini; GIF não o Gemini.) */
export function provedorLe(provedor: AiProvider, tipo: TipoDeLeitura, mime: string): boolean {
  if (tipo === 'pdf') return mime === MIME_DO_PDF
  return IMAGENS_POR_PROVEDOR[provedor].includes(mime)
}

// ------------------------------------------------------------
// Tamanho
// ------------------------------------------------------------

const MB = 1024 * 1024

/**
 * NOSSO teto, abaixo do limite de PDF de todos os provedores: o arquivo vira
 * base64 (4/3 do tamanho) dentro de um corpo JSON, no mesmo processo Node que
 * atende o CRM, e o texto gravado é cortado em `TETO_DO_TEXTO` de qualquer
 * jeito — um PDF de centenas de páginas não cabe na resposta do turno.
 */
export const TETO_PROPRIO_BYTES = 20 * MB

/**
 * O maior arquivo que cada provedor recebe, em bytes do ARQUIVO (o base64
 * cresce 4/3). Acima dele a leitura é `recusada` ("arquivo grande demais").
 * - Gemini: imagem — "Inline image data limits your total request size (text
 *   prompts, system instructions, and inline bytes) to 20MB"
 *   (image-understanding): 14 MB de arquivo = ~18,7 MB em base64; PDF — "up to
 *   50MB or 1000 pages" (document-processing): o nosso teto.
 * - OpenAI: "each file must be under 50 MB" (file-inputs) e até 512 MB por
 *   pedido nas imagens (images-vision): o nosso teto nos dois.
 * - Anthropic: imagem — "10 MB (base64-encoded) when using the Claude API
 *   directly" (vision): 7 MB de arquivo; PDF — "Maximum request size 32 MB"
 *   (pdf-support), ~23 MB de arquivo em base64: o nosso teto.
 * ⚠️ Páginas: Gemini 1000; Anthropic 600 (100 com contexto abaixo de 1M — o
 * Sonnet 5 tem 1M). Não há como contar páginas antes de mandar: o PDF longo
 * demais é recusado pelo provedor, vira `falhou` e, na 3ª tentativa, `recusada`.
 */
export const LIMITE_DE_BYTES: Record<AiProvider, Record<TipoDeLeitura, number>> = {
  gemini: { imagem: 14 * MB, pdf: TETO_PROPRIO_BYTES },
  openai: { imagem: TETO_PROPRIO_BYTES, pdf: TETO_PROPRIO_BYTES },
  anthropic: { imagem: 7 * MB, pdf: TETO_PROPRIO_BYTES },
}

// ------------------------------------------------------------
// O pedido
// ------------------------------------------------------------

/** Teto do texto GRAVADO (caracteres). O corte é declarado no próprio texto. */
export const TETO_DO_TEXTO = 12_000
export const MARCA_DE_CORTE = '[… leitura cortada: o arquivo é maior que o limite de texto]'
/**
 * Teto de tokens da resposta. Folgado: o raciocínio do Gemini 3.x e do
 * gpt-5.4-mini conta dentro dele, e o texto pedido vai até ~6.000 caracteres
 * (`INSTRUCAO_*`). Pedir menos texto encurta a resposta, e é a resposta que
 * leva tempo: o PDF longo que pedia 10.000 caracteres estourava os 30 s.
 */
export const MAX_TOKENS_DA_LEITURA = 8192

/**
 * O prazo da CHAMADA ao provedor, por tipo — próprio da leitura, não o
 * `aiRequestTimeoutMs()` (30 s) das respostas de chat: um PDF de dezenas de
 * páginas leva mais que isso. Cabe no turno (`ia-agentes/turno.ts`): a
 * leitura só COMEÇA com o prazo da prévia sobrando (até ~24 s dos 45 s do
 * turno), e a pior = 20 s de download + 90 s de PDF, ~134 s de rodada —
 * abaixo dos 4 min do recolhedor (`RECOLHER_TURNO_MS`). A leitura que passa
 * do prazo do turno fica GRAVADA e o turno reagenda (`prepararMidias`).
 * Tempo esgotado é falha PASSAGEIRA (não gasta tentativa — `ler-midia.ts`).
 */
export const TEMPO_DA_LEITURA_MS: Record<TipoDeLeitura, number> = {
  imagem: 45_000,
  pdf: 90_000,
}

// Para o MODELO — em inglês, como os demais prompts fixos do projeto. O texto
// lido pode estar em qualquer língua; a descrição sai em português porque é o
// que o escritório lê quando for conferir.
export const INSTRUCAO_DA_IMAGEM =
  'Describe what the image shows and transcribe ALL visible text verbatim, in its original language. ' +
  'If it is a screenshot of a chat, write who said what, in order. ' +
  'Do not interpret, guess or add anything beyond what is visible. ' +
  'Write the description in Brazilian Portuguese. ' +
  'Reply only with the description and the transcribed text — no comments, no labels. ' +
  'Keep the whole reply under 6,000 characters; if the visible text is longer, summarize the rest, keeping every number, date, name and amount.'
export const INSTRUCAO_DO_PDF =
  'Extract the text content of this PDF faithfully, in its original language — keep every number, date, name and amount exactly as written. ' +
  'If the full text would exceed 6,000 characters, summarize it instead, keeping every number, date, name and amount. ' +
  'Reply only with the extracted text (or the summary), under 6,000 characters — no comments, no labels.'

export interface PedidoAoProvedor {
  url: string
  headers: Record<string, string>
  body: string | FormData
}

/**
 * O pedido de LEITURA de uma imagem ou PDF. A chave vai SEMPRE em cabeçalho,
 * nunca na URL (vaza em log de proxy).
 */
export function pedidoDeLeitura(args: {
  provedor: AiProvider
  chave: string
  tipo: TipoDeLeitura
  mime: string
  base64: string
  nomeDoArquivo: string
}): PedidoAoProvedor {
  const instrucao = args.tipo === 'imagem' ? INSTRUCAO_DA_IMAGEM : INSTRUCAO_DO_PDF
  const modelo = MODELO_DE_LEITURA[args.provedor]
  switch (args.provedor) {
    case 'gemini':
      // `inlineData` para imagem e PDF (image-understanding, document-processing).
      return {
        url: geminiEndpoint(modelo),
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.chave },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: instrucao }, { inlineData: { mimeType: args.mime, data: args.base64 } }],
            },
          ],
          generationConfig: { temperature: 0, maxOutputTokens: MAX_TOKENS_DA_LEITURA },
        }),
      }
    case 'openai':
      // A API RESPONSES, não a Chat Completions: é nela que a documentação dá a
      // forma do base64 — `input_image` com `image_url` em data URL
      // (images-vision) e `input_file` com `filename` + `file_data` em data URL
      // (pdf-files; a Chat Completions "accepts only PDF files as `file`
      // content parts", sem exemplo em base64). ⚠️ `store: false`: por padrão a
      // Responses GUARDA a resposta na conta da OpenAI, e isto é documento de
      // cliente. Sem `temperature`: modelo de raciocínio.
      return {
        url: URL_DA_OPENAI_RESPONSES,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${args.chave}` },
        body: JSON.stringify({
          model: modelo,
          store: false,
          max_output_tokens: MAX_TOKENS_DA_LEITURA,
          input: [
            {
              role: 'user',
              content: [
                args.tipo === 'imagem'
                  ? { type: 'input_image', image_url: `data:${args.mime};base64,${args.base64}` }
                  : {
                      type: 'input_file',
                      filename: args.nomeDoArquivo,
                      file_data: `data:${MIME_DO_PDF};base64,${args.base64}`,
                    },
                { type: 'input_text', text: instrucao },
              ],
            },
          ],
        }),
      }
    case 'anthropic':
      // Bloco `image` (vision) ou `document` (pdf-support), base64, ANTES do
      // texto — "Claude works best when images come before text".
      return {
        url: ANTHROPIC_URL,
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': args.chave,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: modelo,
          max_tokens: MAX_TOKENS_DA_LEITURA,
          messages: [
            {
              role: 'user',
              content: [
                args.tipo === 'imagem'
                  ? { type: 'image', source: { type: 'base64', media_type: args.mime, data: args.base64 } }
                  : { type: 'document', source: { type: 'base64', media_type: MIME_DO_PDF, data: args.base64 } },
                { type: 'text', text: instrucao },
              ],
            },
          ],
        }),
      }
    default: {
      const nunca: never = args.provedor
      throw new Error(`provedor desconhecido: ${String(nunca)}`)
    }
  }
}

interface RespostaOpenAi {
  status?: string
  incomplete_details?: { reason?: string } | null
  output?: { type?: string; content?: { type?: string; text?: string; refusal?: string }[] }[]
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }
}

interface RespostaAnthropic {
  content?: { type?: string; text?: string }[]
  stop_reason?: string | null
  usage?: { input_tokens?: number; output_tokens?: number }
}

export interface LeituraDoProvedor {
  texto: string
  /** O provedor parou no teto de tokens: o texto está pela metade. */
  cortado: boolean
  /**
   * O provedor NÃO entregou a leitura: bloqueou, recusou ou parou por outro
   * motivo que não o teto de tokens. O motivo curto; `null` = entregou.
   * ⚠️ Com bloqueio, o texto que veio (pedaço recitado, frase de recusa) NUNCA
   * se grava como o conteúdo do arquivo — é falha da LEITURA, não o arquivo.
   */
  bloqueio: string | null
  usage: AiUsage | null
}

/** O valor como lista — o corpo vem de fora, e um campo fora da forma não pode derrubar a leitura. */
function lista<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v : []
}

/**
 * Os fins do Gemini que ENTREGAM a leitura: `STOP` (completa) e `MAX_TOKENS`
 * (cortada, declarada). Qualquer outro — `SAFETY`, `RECITATION`, `BLOCKLIST`,
 * `PROHIBITED_CONTENT`, `OTHER`… (`FinishReason`,
 * https://ai.google.dev/api/generate-content) — é bloqueio. Sem `finishReason`
 * (forma fora do padrão) não se acusa bloqueio: o texto vazio já é falha.
 */
const FINS_DO_GEMINI_QUE_ENTREGAM = new Set(['STOP', 'MAX_TOKENS'])
/**
 * Os `stop_reason` da Anthropic que ENTREGAM: `end_turn`, `stop_sequence`, e
 * os dois cortes (`max_tokens`, `model_context_window_exceeded`). `refusal`
 * ("Claude declined to generate a response … as a normal HTTP 200 response")
 * e os de ferramenta (`tool_use`, `pause_turn`) não entregam
 * (https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
 */
const FINS_DA_ANTHROPIC_QUE_ENTREGAM = new Set(['end_turn', 'stop_sequence', 'max_tokens', 'model_context_window_exceeded'])
const CORTES_DA_ANTHROPIC = new Set(['max_tokens', 'model_context_window_exceeded'])

/** A resposta de LEITURA de cada provedor → texto, corte, bloqueio e uso. Nunca lança. */
export function lerRespostaDeLeitura(provedor: AiProvider, corpo: unknown): LeituraDoProvedor {
  switch (provedor) {
    case 'gemini': {
      const d = corpo as (GeminiResponse & { promptFeedback?: { blockReason?: string } }) | null
      const fim = d?.candidates?.[0]?.finishReason
      const bloqueioDoPedido = d?.promptFeedback?.blockReason
      return {
        texto: geminiText(d),
        cortado: fim === 'MAX_TOKENS',
        bloqueio: bloqueioDoPedido
          ? `pedido bloqueado (${bloqueioDoPedido})`
          : fim && !FINS_DO_GEMINI_QUE_ENTREGAM.has(fim)
            ? `leitura interrompida (${fim})`
            : null,
        usage: geminiUsage(d),
      }
    }
    case 'openai': {
      // ⚠️ "The `output` array often has more than one item" (o raciocínio vem
      // junto): o texto é o de TODOS os itens `message`, nunca `output[0]`.
      // `output_text` agregado só existe nos SDKs (guides/text).
      // `status`: completed | incomplete | failed | cancelled | in_progress;
      // `incomplete_details.reason`: max_output_tokens | content_filter | … ;
      // a recusa vem como parte `{ type: 'refusal', refusal }` da mensagem
      // (https://developers.openai.com/api/reference/resources/responses/methods/create).
      const d = corpo as RespostaOpenAi | null
      const partes = lista(d?.output)
        .filter((o) => o?.type === 'message')
        .flatMap((o) => lista(o.content))
      const texto = partes
        .filter((c) => c?.type === 'output_text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('')
        .trim()
      const cortado = d?.status === 'incomplete' && d?.incomplete_details?.reason === 'max_output_tokens'
      const recusou = partes.some((c) => c?.type === 'refusal')
      const bloqueio = recusou
        ? 'o modelo se recusou a ler'
        : d?.status === 'completed' || cortado
          ? null
          : d?.status === 'incomplete'
            ? `leitura incompleta (${d?.incomplete_details?.reason ?? 'sem motivo'})`
            : `leitura não concluída (${d?.status ?? 'sem status'})`
      return {
        texto,
        cortado,
        bloqueio,
        usage: normalizeUsage({
          prompt: d?.usage?.input_tokens,
          completion: d?.usage?.output_tokens,
          total: d?.usage?.total_tokens,
        }),
      }
    }
    case 'anthropic': {
      const d = corpo as RespostaAnthropic | null
      const texto = lista(d?.content)
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('')
        .trim()
      const fim = d?.stop_reason ?? null
      return {
        texto,
        cortado: !!fim && CORTES_DA_ANTHROPIC.has(fim),
        bloqueio:
          fim === 'refusal'
            ? 'o modelo se recusou a ler'
            : fim && !FINS_DA_ANTHROPIC_QUE_ENTREGAM.has(fim)
              ? `leitura interrompida (${fim})`
              : null,
        usage: normalizeUsage({ prompt: d?.usage?.input_tokens, completion: d?.usage?.output_tokens }),
      }
    }
    default: {
      const nunca: never = provedor
      throw new Error(`provedor desconhecido: ${String(nunca)}`)
    }
  }
}

/** O texto que se GRAVA: aparado, e com o corte declarado quando houve. */
export function textoParaGravar(texto: string, cortado: boolean): string {
  const limpo = texto.trim()
  if (limpo.length > TETO_DO_TEXTO - MARCA_DE_CORTE.length - 1) {
    return `${limpo.slice(0, TETO_DO_TEXTO - MARCA_DE_CORTE.length - 1).trimEnd()}\n${MARCA_DE_CORTE}`
  }
  return cortado ? `${limpo}\n${MARCA_DE_CORTE}` : limpo
}

// ------------------------------------------------------------
// Áudio pela OpenAI (a queda da transcrição)
// ------------------------------------------------------------

/**
 * A extensão com que o arquivo vai no multipart: a OpenAI decide o formato
 * pelo NOME do arquivo. Desconhecido = `ogg` (100% das notas de voz do acervo).
 */
export function extensaoDoAudio(mime: string | null): string {
  const m = mimeLimpo(mime) ?? ''
  if (m === 'audio/mpeg' || m === 'audio/mp3') return 'mp3'
  if (m === 'audio/mp4' || m === 'audio/m4a' || m === 'audio/x-m4a') return 'm4a'
  if (m === 'audio/wav' || m === 'audio/x-wav' || m === 'audio/wave') return 'wav'
  if (m === 'audio/webm') return 'webm'
  if (m === 'audio/flac' || m === 'audio/x-flac') return 'flac'
  return 'ogg'
}

/**
 * `POST /v1/audio/transcriptions`, multipart, com o português como dica
 * (`languages[]`, uma entrada por língua — a forma do exemplo em curl do guia
 * speech-to-text). Sem `Content-Type` nos cabeçalhos: o `fetch` põe o do
 * multipart, com a fronteira.
 */
export function pedidoDeTranscricaoOpenAi(args: { chave: string; bytes: Uint8Array; mime: string }): PedidoAoProvedor {
  const form = new FormData()
  const ext = extensaoDoAudio(args.mime)
  // Cópia num `Uint8Array` próprio: o `Buffer` do Node pode apontar para um
  // `SharedArrayBuffer`, que o `Blob` não aceita.
  form.append('file', new Blob([new Uint8Array(args.bytes)], { type: args.mime }), `audio.${ext}`)
  form.append('model', MODELO_TRANSCRICAO_OPENAI)
  form.append('languages[]', 'pt')
  form.append('response_format', 'json')
  return { url: URL_DA_OPENAI_TRANSCRICAO, headers: { Authorization: `Bearer ${args.chave}` }, body: form }
}

/**
 * A resposta `json`: `{ text, usage: { type: 'tokens', input_tokens,
 * output_tokens, total_tokens } }` (referência da API). Uso por DURAÇÃO
 * (`type: 'duration'`, `seconds`) não tem token: fica sem registro.
 * ⚠️ `texto: null` = a resposta não trouxe o campo (falha); `''` = trouxe
 * VAZIO, que é o áudio sem fala — `transcrever.ts` o grava como a marca de
 * inaudível do Gemini, nunca como falha (três falhas pagas e uma transferência
 * por um áudio de silêncio).
 */
export function lerRespostaDeTranscricaoOpenAi(corpo: unknown): { texto: string | null; usage: AiUsage | null } {
  const d = corpo as {
    text?: unknown
    usage?: { type?: string; input_tokens?: number; output_tokens?: number; total_tokens?: number }
  } | null
  return {
    texto: typeof d?.text === 'string' ? d.text.trim() : null,
    usage:
      d?.usage?.type === 'duration'
        ? null
        : normalizeUsage({
            prompt: d?.usage?.input_tokens,
            completion: d?.usage?.output_tokens,
            total: d?.usage?.total_tokens,
          }),
  }
}

/**
 * O corpo de erro do provedor, sem a chave: a OpenAI ecoa parte dela em
 * "Incorrect API key provided" — e este texto vai para `transcricao_erro`.
 * Recusa de chave (401/403) nem leva o corpo.
 */
export function erroDoProvedor(provedor: AiProvider, status: number, corpo: string, chave: string): string {
  const nome = provedor === 'gemini' ? 'Gemini' : provedor === 'openai' ? 'OpenAI' : 'Anthropic'
  if (status === 401 || status === 403) return `${nome} recusou a chave (HTTP ${status})`
  const limpo = chave ? corpo.split(chave).join('«chave»') : corpo
  return `${nome} respondeu HTTP ${status}: ${limpo.replace(/sk-[A-Za-z0-9_*-]{6,}/g, '«chave»').slice(0, 200)}`
}

/**
 * A resposta HTTP de erro do PROVEDOR diz algo sobre o ARQUIVO? `false` = não:
 * a falha é da chave (401/403), do modelo fixo que sumiu (404), da cota
 * (429) ou do provedor fora do ar (408, 409, 425, 5xx — o 529 "overloaded"
 * da Anthropic incluso). Essas NÃO gastam as tentativas da leitura
 * (`ler-midia.ts`): o turno reagenda a cada 10 s, e três soluços seguidos
 * carimbavam `recusada` para sempre num arquivo perfeitamente legível. O
 * resto (400, 413, 415, 422…) é o arquivo — conta.
 */
export function falhaPassageira(status: number): boolean {
  return [401, 403, 404, 408, 409, 425, 429].includes(status) || status >= 500
}

/**
 * O nome com que o arquivo vai ao provedor (a OpenAI EXIGE o `filename` do
 * PDF e decide o formato por ele). Nunca vazio; o PDF termina SEMPRE em
 * ".pdf" — o nome que o cliente deu pode não ter extensão ("Extrato
 * setembro") ou ter outra ("scan.bin").
 */
export function nomeParaOProvedor(nome: string | null | undefined, tipo: TipoDeLeitura): string {
  const limpo = (nome ?? '').trim()
  if (tipo === 'imagem') return limpo ? limpo.slice(0, 200) : 'imagem'
  const base = limpo ? limpo.slice(0, 196) : 'documento'
  return /\.pdf$/i.test(base) ? base : `${base}.pdf`
}
