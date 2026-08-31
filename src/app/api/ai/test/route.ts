import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, type AiProvider } from '@/lib/ai/types'

/**
 * POST /api/ai/test  (admin+)
 *
 * "Test key" button: validate a candidate provider/model/key against
 * the provider WITHOUT saving. When `api_key` is omitted the stored
 * key is used, so an admin can re-test an existing config (e.g. after
 * changing the model). Returns `{ ok: true }` on success, 400 with the
 * provider's message on failure.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const provider = body.provider as AiProvider
    // Guarda gêmea da de /api/ai/config — as duas têm de aceitar os
    // MESMOS provedores, senão o "Testar chave" recusa o que o seletor
    // da tela acabou de oferecer (mordeu com o gemini, revisão 941).
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini') {
      return NextResponse.json(
        { error: 'provider must be "openai", "anthropic" or "gemini"' },
        { status: 400 },
      )
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) {
      return NextResponse.json({ error: 'model is required' }, { status: 400 })
    }

    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    let apiKeyPlain = rawKey
    if (!apiKeyPlain) {
      const { data: existing } = await supabase
        .from('ai_configs')
        .select('api_key')
        .eq('account_id', accountId)
        // Agente padrao da conta — ver a nota em /api/ai/config.
        .is('channel_id', null)
        .maybeSingle()
      if (!existing?.api_key) {
        return NextResponse.json(
          { error: 'Enter an API key to test.' },
          { status: 400 },
        )
      }
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return NextResponse.json(
          { error: 'Stored API key could not be decrypted — re-enter your key.' },
          { status: 400 },
        )
      }
    }

    try {
      await validateAiCredentials({
        provider,
        model,
        radarModel: null,
        apiKey: apiKeyPlain,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
      })
    } catch (err) {
      if (err instanceof AiError) {
        // ⚠️ `invalid_key` NÃO ecoa `err.message`: a mensagem do provedor
        // embute a chave enviada ("Incorrect API key provided: sk-…"), e o
        // toast do "Testar chave" a pintaria na tela — inclusive quando a
        // chave testada é a GUARDADA, que o admin nem digitou (sem `api_key`
        // no corpo a rota descriptografa a salva). Sem `error`, o cliente
        // cai no `testRejected` traduzido. É a mesma exceção do save do
        // Radar em /api/ai/config; os demais códigos seguem com a mensagem,
        // que é o que diz "modelo não encontrado".
        const ehChave = err.code === 'invalid_key'
        return NextResponse.json(
          ehChave ? { code: err.code } : { error: err.message, code: err.code },
          { status: 400 },
        )
      }
      console.error('[ai/test] validation error:', err)
      return NextResponse.json(
        { error: 'Could not validate the API key.' },
        { status: 400 },
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
