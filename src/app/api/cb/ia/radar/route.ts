import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, mensagemSeguraDeAiError, type AiProvider } from '@/lib/ai/types'
import { lerChave } from '@/lib/ia-chaves/repo'

/**
 * PATCH /api/cb/ia/radar  `{ radar_model: string | null }`  (admin+)
 *
 * O modelo do Radar (946), gravado SOZINHO na linha padrão de `ai_configs`.
 *
 * ⚠️ Existe para Integrações não precisar mais ECOAR a linha inteira pelo
 * `POST /api/ai/config` (que reescreve `system_prompt`, `is_active`… e
 * apagaria as instruções da empresa num save que fala de outro assunto).
 * Aqui só a coluna `radar_model` muda.
 *
 * O modelo é validado contra o provedor da linha, com a chave DELE
 * (`cb_ia_chaves`, 1047), antes de gravar: o Radar só rodaria no próximo
 * ciclo do agendador, de madrugada, sem ninguém na tela para ler o erro.
 * `null` (ou vazio) = herda o modelo do assistente.
 */
export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    // Validar custa uma geração paga: o balde dos pings.
    const limite = checkRateLimit(`cb:ia-radar:${ctx.userId}`, RATE_LIMITS.integracoesPing)
    if (!limite.success) return rateLimitResponse(limite)

    const corpo = (await request.json().catch(() => null)) as { radar_model?: unknown } | null
    if (!corpo || !('radar_model' in corpo)) {
      return NextResponse.json({ error: 'corpo_invalido', code: 'corpo_invalido' }, { status: 400 })
    }
    // ⚠️ Vazio NÃO pode virar string vazia na coluna: o CHECK da 946 barraria,
    // e no Gemini a URL viraria `/models/:generateContent`.
    const radarModel =
      typeof corpo.radar_model === 'string' && corpo.radar_model.trim()
        ? corpo.radar_model.trim()
        : null

    const { data: padrao, error } = await ctx.supabase
      .from('ai_configs')
      .select('id, provider, model')
      .eq('account_id', ctx.accountId)
      .is('channel_id', null)
      .maybeSingle()
    if (error) {
      console.error('[cb/ia/radar] leitura falhou:', error.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    if (!padrao) {
      return NextResponse.json(
        { error: 'sem_configuracao', code: 'sem_configuracao' },
        { status: 400 },
      )
    }
    const provedor = padrao.provider as AiProvider

    if (radarModel) {
      let chave: string | null
      try {
        const lida = await lerChave(ctx.accountId, provedor)
        if (lida.ilegivel) {
          return NextResponse.json({ error: 'chave_ilegivel', code: 'chave_ilegivel' }, { status: 400 })
        }
        chave = lida.chave
      } catch (err) {
        console.error('[cb/ia/radar] leitura da chave falhou:', err)
        return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
      }
      if (!chave) {
        return NextResponse.json({ error: 'sem_chave', code: 'sem_chave' }, { status: 400 })
      }
      try {
        await validateAiCredentials({
          provider: provedor,
          model: radarModel,
          radarModel: null,
          apiKey: chave,
          systemPrompt: null,
          isActive: true,
          autoReplyEnabled: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        // A mensagem do provedor diz "modelo não encontrado" — menos em
        // `invalid_key`, que ecoa a chave (mensagemSeguraDeAiError).
        const motivo =
          err instanceof AiError ? mensagemSeguraDeAiError(err) : 'erro desconhecido do provedor'
        // O `motivo` é a mensagem do PROVEDOR (em inglês), já sem eco de chave:
        // é ela que diz "modelo não encontrado". A frase em volta a tela traduz.
        return NextResponse.json(
          { error: 'radar_model_invalid', code: 'radar_model_invalid', modelo: radarModel, motivo },
          { status: 400 },
        )
      }
    }

    const { error: erroUpdate, count } = await ctx.supabase
      .from('ai_configs')
      .update({ radar_model: radarModel }, { count: 'exact' })
      .eq('id', padrao.id)
      .eq('account_id', ctx.accountId)
    if (erroUpdate) {
      console.error('[cb/ia/radar] gravação falhou:', erroUpdate.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    // RLS que barra escrita devolve 0 linhas com `error: null`.
    if (!count) {
      return NextResponse.json({ error: 'nada_gravado', code: 'nada_gravado' }, { status: 409 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
