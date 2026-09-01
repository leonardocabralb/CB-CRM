// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI, Anthropic or Gemini.
// ============================================================

export type AiProvider = 'openai' | 'anthropic' | 'gemini'

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider
  /**
   * Modelo do agente de CONVERSA: rascunho, resposta automática e
   * Playground. NÃO é o do Radar (ver `radarModel`) nem o da transcrição
   * (fixo em `MODELO_TRANSCRICAO`).
   */
  model: string
  /**
   * Modelo do Radar de Atendimento (migration 946). `null` = herda
   * `model`, que era o comportamento antes da separação.
   *
   * ⚠️ Existe porque analisar conversa e responder ao cliente são
   * trabalhos diferentes com custos diferentes, e antes disto os dois
   * liam a MESMA coluna: trocar o modelo pensando num mudava o outro,
   * sem aviso.
   */
  radarModel: string | null
  apiKey: string
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Raw text + usage a provider adapter returns before handoff parsing. */
export interface ProviderResult {
  text: string
  usage: AiUsage | null
}

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}

/**
 * A mensagem de um `AiError` que PODE ir para a tela.
 *
 * ⚠️ `invalid_key` é o ÚNICO código cuja mensagem ecoa a CHAVE enviada — a
 * OpenAI devolve "Incorrect API key provided: sk-proj-…abcd", e a chave pode
 * ser a GUARDADA (salvar só o modelo revalida com `decrypt(existing)`), que
 * quem está salvando nem digitou. Esse texto renderizado num painel sai num
 * print de suporte. Os demais códigos preservam a mensagem DE PROPÓSITO: é
 * ela que diz "modelo não encontrado" (decisão registrada no CLAUDE.md).
 * Toda rota que devolve `err.message` de AiError ao cliente passa por aqui
 * (#30 do plano 31/08 — config, draft e playground ecoavam).
 */
export function mensagemSeguraDeAiError(err: AiError): string {
  return err.code === 'invalid_key' ? 'o provedor recusou a chave' : err.message
}
