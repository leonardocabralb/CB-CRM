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
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}

/**
 * Os modelos com que a chave é testada, em ordem: o padrão do provedor e, se
 * for outro, o do assistente da conta. Basta UM responder — o que se testa é
 * a CHAVE. Testar só com o do assistente travava a troca de chave quando o
 * provedor aposentava aquele modelo (a chave nova recusada por "modelo não
 * encontrado", e o modelo não trocável sem uma chave que funcione).
 */
async function modelosParaTestar(accountId: string, provedor: AiProvider): Promise<string[]> {
  const modelos = [AI_PROVIDER_DEFAULT_MODEL[provedor]]
  const { data } = await supabaseAdmin()
    .from('ai_configs')
    .select('provider, model')
    .eq('account_id', accountId)
    .is('channel_id', null)
    .maybeSingle()
  if (data && data.provider === provedor && typeof data.model === 'string' && data.model) {
    if (!modelos.includes(data.model)) modelos.push(data.model)
  }
  return modelos
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
      return NextResponse.json({ error: 'provedor_invalido', code: 'provedor_invalido' }, { status: 400 })
    }
    const provedor = corpo.provedor
    const chave = typeof corpo.chave === 'string' ? corpo.chave.trim() : ''
    if (!chave) {
      return NextResponse.json({ error: 'chave_vazia', code: 'chave_vazia' }, { status: 400 })
    }

    let primeiroErro: unknown = null
    let validou = false
    for (const modelo of await modelosParaTestar(ctx.accountId, provedor)) {
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
        validou = true
        break
      } catch (err) {
        primeiroErro ??= err
        // Chave recusada não melhora com outro modelo.
        if (err instanceof AiError && err.code === 'invalid_key') break
      }
    }
    if (!validou) {
      if (primeiroErro instanceof AiError) {
        return NextResponse.json(
          { error: mensagemSeguraDeAiError(primeiroErro), code: primeiroErro.code },
          { status: 400 },
        )
      }
      console.error('[cb/ia/chaves PUT] validação falhou:', primeiroErro)
      return NextResponse.json(
        { error: 'provider_error', code: 'provider_error' },
        { status: 400 },
      )
    }

    // Avisos saem como CÓDIGO (a tela traduz e pinta de âmbar, não de verde):
    // - `embeddings_recusado`: a chave da OpenAI também serve à base de
    //   conhecimento, e uma chave de projeto RESTRITA pode gerar texto e não
    //   gerar embedding. Grava assim mesmo (o chat funciona) e avisa.
    // - `modulos_nao_criados`: ver abaixo.
    const avisos: string[] = []
    if (provedor === 'openai') {
      try {
        await embedTexts(chave, ['ping'])
      } catch {
        avisos.push('embeddings_recusado')
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
    if (erroPadrao) {
      console.error('[cb/ia/chaves PUT] leitura da configuração dos módulos falhou:', erroPadrao.message)
      avisos.push('modulos_nao_criados')
    } else if (!padrao) {
      const { error: erroInsert } = await ctx.supabase.from('ai_configs').insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        provider: provedor,
        model: AI_PROVIDER_DEFAULT_MODEL[provedor],
        is_active: false,
      })
      if (erroInsert) {
        // A chave ficou gravada, mas o Radar ficaria sem provedor (`sem_ia`)
        // com a tela dizendo "Salvo". Aviso, não sucesso.
        console.error('[cb/ia/chaves PUT] criação da configuração dos módulos falhou:', erroInsert.message)
        avisos.push('modulos_nao_criados')
      }
    }

    return NextResponse.json({ ok: true, avisos })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
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
      return NextResponse.json({ error: 'provedor_invalido', code: 'provedor_invalido' }, { status: 400 })
    }
    const apagada = await apagarChave(ctx.accountId, provedor)

    // ⚠️ A cópia LEGADA também sai. A 1042 deixou `ai_configs.api_key` (e
    // `embeddings_api_key`) com o texto cifrado de antes, para o app anterior
    // poder voltar atrás — e qualquer membro lê essa coluna pelo PostgREST.
    // Sem limpar, a chave "apagada" continuaria no banco e voltaria a valer
    // numa reversão do deploy (ou num replay da cópia da 1042).
    const db = supabaseAdmin()
    const { error: erroLegado } = await db
      .from('ai_configs')
      .update({ api_key: null })
      .eq('account_id', ctx.accountId)
      .eq('provider', provedor)
    const { error: erroEmbeddings } =
      provedor === 'openai'
        ? await db.from('ai_configs').update({ embeddings_api_key: null }).eq('account_id', ctx.accountId)
        : { error: null }
    if (erroLegado || erroEmbeddings) {
      console.error(
        '[cb/ia/chaves DELETE] limpeza da cópia legada falhou:',
        erroLegado?.message ?? erroEmbeddings?.message,
      )
      return NextResponse.json({ error: 'banco', code: 'banco', apagada }, { status: 500 })
    }
    return NextResponse.json({ ok: true, apagada })
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('[ia-chaves]')) {
      console.error(err.message)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
