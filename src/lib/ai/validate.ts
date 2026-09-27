import { generateReply } from './generate'
import { AiError, type AiConfig } from './types'

/**
 * Cheap liveness + auth check: one tiny generation against the
 * configured provider/model with the caller's key. Throws `AiError`
 * (invalid_key / rate_limited / network / timeout) on failure, resolves
 * on success. Used by the settings "Test key" button and before
 * persisting a config — the same "verify before save" discipline the
 * WhatsApp config uses with Meta.
 */
export async function validateAiCredentials(config: AiConfig): Promise<void> {
  try {
    await generateReply({
      config,
      systemPrompt: 'You are a connectivity check. Reply with the single word: OK.',
      messages: [{ role: 'user', content: 'ping' }],
    })
  } catch (err) {
    // Resposta cortada pelo teto É resposta: o provedor aceitou a chave e o
    // modelo existe, que é tudo o que o ping pergunta. Sem isto, o texto
    // cortado que antes passava no ping viraria "chave/modelo recusado".
    if (err instanceof AiError && err.code === 'output_truncated') return
    throw err
  }
}
