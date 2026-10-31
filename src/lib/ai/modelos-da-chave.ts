// ============================================================
// Os modelos de TEXTO que a chave da CONTA oferece, por provedor (25/10/2026,
// pedido do operador: "os seletores devem ser interligados com a chave de IA
// pra mostrar os modelos disponíveis"). Quem mostra é o seletor de modelo do
// agente e do Radar (`GET /api/cb/ia/modelos`).
//
// ⚠️ Só no SERVIDOR: a chave é lida pelo repositório (`lerChave`, cliente de
// serviço — `cb_ia_chaves` é fechada ao navegador) e NUNCA sai daqui. O que
// volta para a rota é a lista de `{ id, nome }` ou o MOTIVO (código), nunca a
// mensagem do provedor (a OpenAI ecoa a chave nela); o log passa por
// `semSegredo`.
//
// A forma de cada listagem foi conferida na documentação oficial em
// 25/10/2026:
//   - Anthropic `GET /v1/models` (x-api-key + anthropic-version no cabeçalho;
//     `limit` até 1000, página seguinte por `after_id` = `last_id` enquanto
//     `has_more`) — todo modelo da lista é de texto;
//   - Gemini `GET /v1beta/models` (x-goog-api-key no cabeçalho, NUNCA `?key=`;
//     `pageSize` até 1000, página seguinte por `pageToken`) — só os que têm
//     `generateContent` e não são embedding, imagem, vídeo, voz ou `aqa`;
//   - OpenAI `GET /v1/models` (Bearer; a lista vem inteira) — só `gpt-*`,
//     `o<n>*` e `chatgpt-*` que o `/v1/chat/completions` do nosso adapter
//     atende (fora áudio, tempo real, transcrição, voz, imagem, embedding,
//     moderação, busca e os que só existem na API Responses).
// A página seguinte é montada AQUI sobre a URL fixa do provedor (o token vai
// num parâmetro): a paginação nunca sai do host.
//
// Prazo curto (`PRAZO_DA_LISTA_MS`, para todas as páginas juntas): a lista é
// conforto da tela — estourou, a tela volta ao campo de texto. Cache em
// memória por conta, provedor e IMPRESSÃO da chave (`VALIDADE_DO_CACHE_MS`):
// trocar a chave em Integrações muda a impressão, e a lista nova vem na hora.
// O cache é por processo (o deploy roda dois): no pior caso, uma leitura a
// mais.
// ============================================================

import { createHash } from 'node:crypto'

import { lerChave } from '@/lib/ia-chaves/repo'
import type { ModeloDaChave } from './defaults'
import { ANTHROPIC_VERSION } from './providers/anthropic'
import type { AiProvider } from './types'

export type { ModeloDaChave } from './defaults'

/** Por que a lista não veio. Código, nunca a mensagem do provedor. */
export type CodigoDaFalhaDaLista =
  | 'invalid_key'
  | 'rate_limited'
  | 'timeout'
  | 'network'
  | 'provider_error'
  | 'resposta_estranha'
  | 'chave_ilegivel'
  | 'leitura_falhou'

/** A lista de UM provedor, como a rota a devolve. */
export type ModelosDoProvedor =
  | { ok: true; modelos: ModeloDaChave[] }
  | { ok: false; motivo: 'sem_chave' }
  | { ok: false; motivo: 'falhou'; codigo: CodigoDaFalhaDaLista }

export const URL_DOS_MODELOS: Record<AiProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1/models',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  openai: 'https://api.openai.com/v1/models',
}

/** O prazo de TODAS as páginas de um provedor, somadas. */
export const PRAZO_DA_LISTA_MS = 8_000
/** Teto de páginas: com 1000 por página, nenhum provedor chega perto. */
export const MAX_PAGINAS_DA_LISTA = 10
export const VALIDADE_DO_CACHE_MS = 10 * 60_000

class FalhaDaLista extends Error {
  constructor(
    readonly codigo: CodigoDaFalhaDaLista,
    detalhe: string,
  ) {
    super(detalhe)
  }
}

function semSegredo(texto: string, chave: string): string {
  return chave.length >= 8 ? texto.replaceAll(chave, '[chave]') : texto
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

// ------------------------------------------------------------
// Os recortes de cada provedor (PUROS, testados)
// ------------------------------------------------------------

/**
 * Gemini: o modelo serve ao `generateContent` do adapter? Fora: embedding,
 * imagem (Imagen, os "-image" e os "Nano Banana", que geram imagem — medido na
 * chave real em 25/10/2026), vídeo (Veo), voz e áudio nativo, `aqa` e a
 * transcrição — o `gemini-3.5-transcribe` responde 200 VAZIO pelo
 * `generateContent`, cobrando a entrada (`.claude/rules/ia.md`).
 */
const FORA_DO_GEMINI = /(embedding|imagen|image|nano-banana|veo|video|tts|aqa|transcribe|audio)/i

export function ehModeloDeTextoDoGemini(m: unknown): boolean {
  if (!ehObjeto(m) || typeof m.name !== 'string') return false
  const metodos = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : []
  return metodos.includes('generateContent') && !FORA_DO_GEMINI.test(m.name)
}

/**
 * OpenAI: o id é de um modelo que o `/v1/chat/completions` do adapter atende?
 * Só `gpt-*`, `o<n>*` e `chatgpt-*` (o `ft:` dos ajustados fica fora). Fora,
 * além do pedido do operador (áudio, tempo real, transcrição, voz, imagem,
 * embedding, moderação, busca): o `instruct` (só a API antiga de completions),
 * o `codex`, o `deep-research` e os `-pro`, que a OpenAI serve só na API
 * Responses — escolhidos aqui, todo turno falharia.
 */
const PREFIXO_DA_OPENAI = /^(gpt-|o\d|chatgpt-)/
const FORA_DA_OPENAI = /(audio|realtime|transcribe|tts|image|embedding|moderation|search|instruct|codex|deep-research|-pro\b)/i

export function ehModeloDeTextoDaOpenai(id: string): boolean {
  return PREFIXO_DA_OPENAI.test(id) && !FORA_DA_OPENAI.test(id)
}

// ------------------------------------------------------------
// A leitura (I/O)
// ------------------------------------------------------------

async function pedir(
  url: string,
  cabecalhos: Record<string, string>,
  prazoAte: number,
  chave: string,
): Promise<unknown> {
  const resta = prazoAte - Date.now()
  if (resta <= 0) throw new FalhaDaLista('timeout', 'prazo da lista esgotado entre as páginas')
  let res: Response
  try {
    // `redirect: 'error'`: o provedor não redireciona a listagem; se um dia
    // redirecionar, o cabeçalho com a chave não segue para outro lugar.
    res = await fetch(url, { headers: cabecalhos, redirect: 'error', signal: AbortSignal.timeout(resta) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new FalhaDaLista('timeout', 'o provedor demorou demais')
    }
    throw new FalhaDaLista('network', semSegredo(err instanceof Error ? err.message : String(err), chave))
  }
  if (!res.ok) {
    const corpo = semSegredo(await res.text().catch(() => ''), chave).slice(0, 300)
    const codigo: CodigoDaFalhaDaLista =
      res.status === 401 || res.status === 403
        ? 'invalid_key'
        : res.status === 429
          ? 'rate_limited'
          : 'provider_error'
    throw new FalhaDaLista(codigo, `HTTP ${res.status}: ${corpo}`)
  }
  try {
    return await res.json()
  } catch {
    throw new FalhaDaLista('resposta_estranha', 'o corpo não é JSON')
  }
}

function nomeOuId(nome: unknown, id: string): string {
  return typeof nome === 'string' && nome.trim() ? nome.trim() : id
}

async function listarAnthropic(chave: string, prazoAte: number): Promise<ModeloDaChave[]> {
  const modelos: ModeloDaChave[] = []
  let depoisDe: string | null = null
  for (let pagina = 0; pagina < MAX_PAGINAS_DA_LISTA; pagina++) {
    const url = new URL(URL_DOS_MODELOS.anthropic)
    url.searchParams.set('limit', '1000')
    if (depoisDe) url.searchParams.set('after_id', depoisDe)
    const corpo = await pedir(
      url.toString(),
      { 'x-api-key': chave, 'anthropic-version': ANTHROPIC_VERSION },
      prazoAte,
      chave,
    )
    if (!ehObjeto(corpo) || !Array.isArray(corpo.data)) {
      throw new FalhaDaLista('resposta_estranha', 'sem `data`')
    }
    for (const m of corpo.data) {
      if (ehObjeto(m) && typeof m.id === 'string' && m.id) modelos.push({ id: m.id, nome: nomeOuId(m.display_name, m.id) })
    }
    const ultimo = corpo.last_id
    if (corpo.has_more !== true || typeof ultimo !== 'string' || !ultimo) return modelos
    // O mesmo cursor de novo laçaria até o teto: a lista não fecha.
    if (ultimo === depoisDe) throw new FalhaDaLista('resposta_estranha', 'o cursor não avançou')
    depoisDe = ultimo
  }
  // Lista pela metade esconderia o modelo salvo ("não está na lista") — a tela
  // volta ao campo de texto.
  throw new FalhaDaLista('resposta_estranha', `mais de ${MAX_PAGINAS_DA_LISTA} páginas`)
}

async function listarGemini(chave: string, prazoAte: number): Promise<ModeloDaChave[]> {
  const modelos: ModeloDaChave[] = []
  let token: string | null = null
  for (let pagina = 0; pagina < MAX_PAGINAS_DA_LISTA; pagina++) {
    const url = new URL(URL_DOS_MODELOS.gemini)
    url.searchParams.set('pageSize', '1000')
    if (token) url.searchParams.set('pageToken', token)
    const corpo = await pedir(url.toString(), { 'x-goog-api-key': chave }, prazoAte, chave)
    if (!ehObjeto(corpo)) throw new FalhaDaLista('resposta_estranha', 'corpo não é objeto')
    // A conta sem modelo nenhum volta sem `models`: lista vazia, não falha.
    const lista = Array.isArray(corpo.models) ? corpo.models : []
    for (const m of lista) {
      if (!ehModeloDeTextoDoGemini(m)) continue
      const registro = m as { name: string; displayName?: unknown }
      // `models/gemini-3.8-flash` → `gemini-3.8-flash`: o adapter monta o
      // caminho com o prefixo (`geminiEndpoint`), e o agente guarda o id sem ele.
      const id = registro.name.replace(/^models\//, '')
      if (id) modelos.push({ id, nome: nomeOuId(registro.displayName, id) })
    }
    const proximo = corpo.nextPageToken
    if (typeof proximo !== 'string' || !proximo) return modelos
    if (proximo === token) throw new FalhaDaLista('resposta_estranha', 'o cursor não avançou')
    token = proximo
  }
  throw new FalhaDaLista('resposta_estranha', `mais de ${MAX_PAGINAS_DA_LISTA} páginas`)
}

async function listarOpenai(chave: string, prazoAte: number): Promise<ModeloDaChave[]> {
  const corpo = await pedir(URL_DOS_MODELOS.openai, { Authorization: `Bearer ${chave}` }, prazoAte, chave)
  if (!ehObjeto(corpo) || !Array.isArray(corpo.data)) {
    throw new FalhaDaLista('resposta_estranha', 'sem `data`')
  }
  // A OpenAI não manda nome nem ordem: o mais novo (`created`) primeiro.
  return corpo.data
    .filter((m): m is { id: string; created?: unknown } => ehObjeto(m) && typeof m.id === 'string' && m.id !== '')
    .filter((m) => ehModeloDeTextoDaOpenai(m.id))
    .sort((a, b) => (typeof b.created === 'number' ? b.created : 0) - (typeof a.created === 'number' ? a.created : 0))
    .map((m) => ({ id: m.id, nome: m.id }))
}

/**
 * Os modelos de texto que ESTA chave alcança. Lança `FalhaDaLista` (só
 * aqui dentro: quem chama de fora usa `modelosDaConta`).
 */
async function listarModelosDaChave(provedor: AiProvider, chave: string): Promise<ModeloDaChave[]> {
  const prazoAte = Date.now() + PRAZO_DA_LISTA_MS
  switch (provedor) {
    case 'anthropic':
      return listarAnthropic(chave, prazoAte)
    case 'gemini':
      return listarGemini(chave, prazoAte)
    case 'openai':
      return listarOpenai(chave, prazoAte)
    default: {
      const nunca: never = provedor
      throw new FalhaDaLista('provider_error', `provedor desconhecido: ${String(nunca)}`)
    }
  }
}

// ------------------------------------------------------------
// A conta (chave pelo repositório + cache)
// ------------------------------------------------------------

const CACHE = new Map<string, { ate: number; modelos: ModeloDaChave[] }>()

/** Só para os testes: o cache é do módulo. */
export function limparCacheDosModelos(): void {
  CACHE.clear()
}

/** A impressão da chave no cache: a chave em si nunca é guardada nele. */
function impressao(chave: string): string {
  return createHash('sha256').update(chave).digest('hex').slice(0, 16)
}

export interface ModelosDaConta {
  modelos: ModelosDoProvedor
  /**
   * A chave deste provedor LÊ a mídia do cliente? A régua de `escolherLeitor`
   * (`src/lib/transcricao/escolher-leitor.ts`): há chave, ela decifra, e na
   * OpenAI não é a "só da base". `null` = a leitura da chave falhou (não se
   * sabe).
   */
  leAMidia: boolean | null
}

/**
 * Os modelos da chave da CONTA neste provedor. Nunca lança: falha vira
 * `motivo: 'falhou'` com o código. A chave da OpenAI "só da base" (1047) é
 * `sem_chave`: nenhuma tela a oferece ao chat.
 */
export async function modelosDaConta(
  accountId: string,
  provedor: AiProvider,
  opcoes: { atualizar?: boolean } = {},
): Promise<ModelosDaConta> {
  let lida: Awaited<ReturnType<typeof lerChave>>
  try {
    lida = await lerChave(accountId, provedor)
  } catch (err) {
    console.error(`[ia/modelos] leitura da chave ${provedor} falhou:`, err instanceof Error ? err.message : err)
    return { modelos: { ok: false, motivo: 'falhou', codigo: 'leitura_falhou' }, leAMidia: null }
  }
  if (lida.ilegivel) {
    return { modelos: { ok: false, motivo: 'falhou', codigo: 'chave_ilegivel' }, leAMidia: false }
  }
  if (!lida.chave) return { modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false }
  if (provedor === 'openai' && lida.soDaBase === true) {
    return { modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false }
  }
  const chave = lida.chave

  const agora = Date.now()
  const chaveDoCache = `${accountId}:${provedor}:${impressao(chave)}`
  const guardada = CACHE.get(chaveDoCache)
  if (!opcoes.atualizar && guardada && guardada.ate > agora) {
    return { modelos: { ok: true, modelos: guardada.modelos }, leAMidia: true }
  }

  try {
    const modelos = await listarModelosDaChave(provedor, chave)
    // Os vencidos saem a cada gravação: o mapa não cresce com chaves trocadas.
    for (const [k, v] of CACHE) if (v.ate <= agora) CACHE.delete(k)
    CACHE.set(chaveDoCache, { ate: agora + VALIDADE_DO_CACHE_MS, modelos })
    return { modelos: { ok: true, modelos }, leAMidia: true }
  } catch (err) {
    // Falha NÃO entra no cache: um soluço não esconde a lista por 10 minutos.
    const codigo = err instanceof FalhaDaLista ? err.codigo : 'provider_error'
    const detalhe = semSegredo(err instanceof Error ? err.message : String(err), chave)
    console.error(`[ia/modelos] a lista do ${provedor} falhou (${codigo}): ${detalhe}`)
    return { modelos: { ok: false, motivo: 'falhou', codigo }, leAMidia: true }
  }
}
