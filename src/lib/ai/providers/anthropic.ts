import { AiError, type ChatMessage, type ProviderResult } from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import { comecarNoCliente } from './comeca-no-cliente'
import {
  normalizeUsage,
  providerHttpError,
  respostaCortada,
  toNetworkError,
  type ProviderArgs,
} from './shared'

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
  stop_reason?: string
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
}

/**
 * NOSSO (09/11/2026, `.claude/rules/ia-cache-do-pedido.md`): o cache dos
 * pedaços FIXOS do pedido dura 1 h. Gravar custa 2× a entrada e ler, 0,1×;
 * com 5 min (1,25×) a gravação é mais barata, mas o acerto cai de ~93% para
 * ~65% no volume medido do Trabalhista (o relatório de 09/11). Abaixo de ~2
 * chamadas por hora do mesmo agente, o 5 min sairia mais barato.
 */
export const TTL_DO_CACHE = '1h'

/**
 * O `system` da Anthropic: o texto inteiro, ou — com os pedaços — um bloco
 * por pedaço, com a marca de cache nos fixos. Os pedaços já trazem a linha em
 * branco que os separa (`juntarPartes`).
 */
export function sistemaDaAnthropic(
  systemPrompt: string,
  partes: ProviderArgs['systemPartes'],
): string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral'; ttl: typeof TTL_DO_CACHE } }> {
  if (!partes || partes.length === 0) return systemPrompt
  return partes.map((p) =>
    p.cache
      ? { type: 'text' as const, text: p.texto, cache_control: { type: 'ephemeral' as const, ttl: TTL_DO_CACHE } }
      : { type: 'text' as const, text: p.texto },
  )
}

/**
 * Anthropic's Messages API requires strictly alternating roles that
 * begin with `user`. ⚠️ NOSSO (09/11/2026): the business's own opening
 * messages (the ad form, a message from the CRM) are KEPT behind a system
 * note instead of dropped — dropped, the model saw only the customer's
 * answer without the question (`comeca-no-cliente.ts`). Guarantees a valid,
 * non-empty payload.
 */
function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  return comecarNoCliente(messages)
}

/**
 * Call Anthropic's Messages endpoint with the caller's own key.
 * Returns the raw assistant text + token usage (handoff parsing happens
 * in `generateReply`).
 */
export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, systemPartes, messages, timeoutMs } = args

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: sistemaDaAnthropic(systemPrompt, systemPartes),
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: normalizeForAnthropic(messages),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError('Anthropic', res)
  }

  const data = (await res.json().catch(() => null)) as AnthropicResponse | null
  // Antes do texto: com o teto batido (o Sonnet 5 raciocina sem `thinking` no
  // pedido, e o raciocínio conta nele), o que veio é a resposta pela metade.
  if (data?.stop_reason === 'max_tokens') {
    throw respostaCortada('Anthropic')
  }
  const text = data?.content
    ?.filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
    .trim()
  if (!text) {
    throw new AiError('Anthropic returned an empty response.', {
      code: 'empty_response',
    })
  }
  return { text, usage: usoDaAnthropic(data?.usage) }
}

/**
 * Anthropic reports input/output but no total — normalizeUsage sums. ⚠️
 * NOSSO (09/11/2026): com cache, `input_tokens` é só o RESTO sem cache; a
 * entrada inteira é ele + o gravado + o lido. Sem somar, o custo registrado
 * cairia para uma fração do real.
 */
export function usoDaAnthropic(u: AnthropicResponse['usage']) {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const gravado = n(u?.cache_creation_input_tokens)
  const lido = n(u?.cache_read_input_tokens)
  return normalizeUsage({
    prompt: n(u?.input_tokens) + gravado + lido,
    completion: u?.output_tokens,
    cacheRead: lido,
    cacheWrite: gravado,
  })
}
