import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import { AI_PROVIDER_DEFAULT_MODEL } from '@/lib/ai/defaults'
import { AiError, mensagemSeguraDeAiError, type AiProvider } from '@/lib/ai/types'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  apagarChave,
  ehProvedor,
  gravarChave,
  lerEstado,
} from '@/lib/ia-chaves/repo'

/**
 * Chaves de IA por PROVEDOR (migration 1042, D1 do
 * docs/PLANO-agentes-de-ia.md). Só administrador.
 *
 * - `GET`    → se cada provedor tem chave, e desde quando. Nunca a chave.
 * - `PUT`    `{ provedor, chave }` → valida no provedor e grava (troca).
 * - `DELETE` `?provedor=` → apaga. Quem chama já mostrou o que para.
 *
 * ⚠️ A chave NUNCA volta em resposta nenhuma, nem mascarada, e a falha de
 * validação passa por `mensagemSeguraDeAiError`: a OpenAI ecoa a chave na
 * mensagem de erro ("Incorrect API key provided: sk-…").
 */

export async function GET() {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-chaves:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)
    const chaves = await lerEstado(ctx.accountId)
    return NextResponse.json({ chaves })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'Não foi possível ler as chaves.' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}

/**
 * O modelo usado para validar a chave: o do assistente da conta quando ele
 * é deste provedor (testa exatamente o que vai rodar), senão o padrão do
 * provedor.
 */
async function modeloParaTestar(accountId: string, provedor: AiProvider): Promise<string> {
  const { data } = await supabaseAdmin()
    .from('ai_configs')
    .select('provider, model')
    .eq('account_id', accountId)
    .is('channel_id', null)
    .maybeSingle()
  if (data && data.provider === provedor && typeof data.model === 'string' && data.model) {
    return data.model
  }
  return AI_PROVIDER_DEFAULT_MODEL[provedor]
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireRole('admin')
    // Cada gravação custa uma geração paga no provedor: o balde dos pings.
    const limite = checkRateLimit(`cb:ia-chaves:ping:${ctx.userId}`, RATE_LIMITS.integracoesPing)
    if (!limite.success) return rateLimitResponse(limite)

    const corpo = (await request.json().catch(() => null)) as {
      provedor?: unknown
      chave?: unknown
    } | null
    if (!corpo || !ehProvedor(corpo.provedor)) {
      return NextResponse.json({ error: 'Provedor inválido.', code: 'provedor_invalido' }, { status: 400 })
    }
    const provedor = corpo.provedor
    const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : ''
    if (!chave) {
      return NextResponse.json({ error: 'Informe a chave.', code: 'chave_vazia' }, { status: 400 })
    }

    const modelo = await modeloParaTestar(ctx.accountId, provedor)
    try {
      await validateAiCredentials({
        provider: provedor,
        model: modelo,
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
      if (err instanceof AiError) {
        return NextResponse.json(
          { error: mensagemSeguraDeAiError(err), code: err.code },
          { status: 400 },
        )
      }
      console.error('[cb/ia/chaves PUT] validação falhou:', err)
      return NextResponse.json(
        { error: 'Não foi possível validar a chave com o provedor.', code: 'provider_error' },
        { status: 400 },
      )
    }

    // A chave da OpenAI também serve à base de conhecimento (embeddings). Uma
    // chave de projeto RESTRITA pode gerar texto e não gerar embedding: grava
    // assim mesmo (o chat funciona) e avisa, em vez de pintar tudo de verde.
    let aviso: string | null = null
    if (provedor === 'openai') {
      try {
        await embedTexts(chave, ['ping'])
      } catch (err) {
        aviso =
          err instanceof AiError
            ? `A chave funciona para texto, mas não para a busca da base de conhecimento: ${mensagemSeguraDeAiError(err)}`
            : 'A chave funciona para texto, mas não para a busca da base de conhecimento.'
      }
    }

    await gravarChave(ctx.accountId, provedor, chave, ctx.userId)

    // PRIMEIRA configuração da conta: sem a linha padrão de `ai_configs`, o
    // Radar não teria provedor nem modelo e ficaria em `sem_ia` com a chave
    // cadastrada. Nasce com o provedor desta chave, o modelo padrão dele e o
    // assistente DESLIGADO — o mesmo que salvar a primeira chave em
    // Integrações fazia antes da 1042. Linha que já existe não é tocada.
    const { data: padrao, error: erroPadrao } = await ctx.supabase
      .from('ai_configs')
      .select('id')
      .eq('account_id', ctx.accountId)
      .is('channel_id', null)
      .maybeSingle()
    if (!erroPadrao && !padrao) {
      const { error: erroInsert } = await ctx.supabase.from('ai_configs').insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        provider: provedor,
        model: AI_PROVIDER_DEFAULT_MODEL[provedor],
        is_active: false,
      })
      if (erroInsert) {
        console.error('[cb/ia/chaves PUT] criação da configuração dos módulos falhou:', erroInsert.message)
      }
    }

    return NextResponse.json({ ok: true, aviso })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'Não foi possível gravar a chave.' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-chaves:${ctx.userId}`, RATE_LIMITS.adminAction)
    if (!limite.success) return rateLimitResponse(limite)

    const provedor = new URL(request.url).searchParams.get('provedor')
    if (!ehProvedor(provedor)) {
      return NextResponse.json({ error: 'Provedor inválido.', code: 'provedor_invalido' }, { status: 400 })
    }
    const apagada = await apagarChave(ctx.accountId, provedor)
    return NextResponse.json({ ok: true, apagada })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'Não foi possível apagar a chave.' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
