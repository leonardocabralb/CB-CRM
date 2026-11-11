import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGemini } from './providers/gemini'
import type { ParteDoSistema } from './providers/shared'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /**
   * NOSSO (09/11/2026): o MESMO `systemPrompt` em pedaços, com os fixos
   * marcados para o cache do provedor (o agente de IA: `partesDoPedidoDoAgente`).
   * Só a Anthropic os usa; os outros mandam o texto inteiro.
   */
  systemPartes?: readonly ParteDoSistema[]
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /** Teto desta chamada (o turno do agente passa o que sobra do prazo dele).
   *  Ausente = o teto. Nunca passa do teto. */
  timeoutMs?: number
  /**
   * O teto no lugar do global (`aiRequestTimeoutMs()`, 30 s). Só a resposta
   * do AGENTE de IA o usa (`PRAZO_DA_GERACAO_MS`, 45 s: turno, retomada e
   * Playground); as outras chamadas seguem no global.
   */
  tetoMs?: number
  /**
   * NOSSO (10/11/2026): devolve também o RESUMO do raciocínio, onde o modelo
   * já raciocina por padrão (Anthropic família 5, Gemini 2.5+). Só o
   * Playground passa; o turno e a retomada, nunca — o pedido deles não muda.
   */
  mostrarRaciocinio?: boolean
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, systemPartes, messages } = args
  const teto = args.tetoMs !== undefined && args.tetoMs > 0 ? args.tetoMs : aiRequestTimeoutMs()
  const timeoutMs = args.timeoutMs !== undefined && args.timeoutMs > 0 ? Math.min(args.timeoutMs, teto) : teto
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    systemPartes,
    messages,
    timeoutMs,
    ...(args.mostrarRaciocinio === true ? { raciocinio: true } : {}),
  }

  let result: { text: string; usage: AiUsage | null; raciocinio?: string }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  const gerada = parseGeneration(result.text, result.usage)
  return result.raciocinio ? { ...gerada, raciocinio: result.raciocinio } : gerada
}

/**
 * Split the raw model output into `{ text, handoff, usage }`. The
 * sentinel can appear alone or trailing a partial reply; either way we
 * treat the turn as a handoff and strip the marker from any remaining
 * text. `usage` is passed straight through (null when the provider
 * didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
