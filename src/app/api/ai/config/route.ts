import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { lerChave, lerEstado } from '@/lib/ia-chaves/repo'
import { validateAiCredentials } from '@/lib/ai/validate'
import { AiError, mensagemSeguraDeAiError, type AiProvider } from '@/lib/ai/types'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. No key is ever returned — only `has_key` (the
 * provider of this config has a key in `cb_ia_chaves`) and `chaves`
 * (which providers have one).
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'provider, model, radar_model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id',
      )
      .eq('account_id', accountId)
      // Esta tela gerencia o agente PADRAO da conta. Desde a 903 o UNIQUE
      // (account_id) virou dois indices parciais — sem este filtro, o
      // .maybeSingle() estoura assim que existir um agente por canal, e o
      // UPDATE/DELETE atingiria TODOS os agentes em vez de so o padrao.
      .is('channel_id', null)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    // ⚠️ As chaves moram em `cb_ia_chaves` desde a 1042, uma por provedor
    // (D1 do docs/PLANO-agentes-de-ia.md), FECHADA ao navegador: o estado é
    // lido pelo serviço, e só os booleanos saem daqui. Falha dessa leitura
    // é 500, nunca "sem chave" (a tela mandaria cadastrar de novo uma chave
    // que existe).
    let estado: Awaited<ReturnType<typeof lerEstado>>
    try {
      estado = await lerEstado(accountId)
    } catch (err) {
      console.error('[ai/config GET] leitura das chaves falhou:', err)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }
    const temChave = (p: string) => estado.some((e) => e.provedor === p && e.existe)

    if (!data) {
      return NextResponse.json({
        configured: false,
        chaves: estado.map((e) => ({ provedor: e.provedor, existe: e.existe })),
      })
    }
    return NextResponse.json({
      configured: true,
      has_key: temChave(data.provider as string),
      has_embeddings_key: temChave('openai'),
      chaves: estado.map((e) => ({ provedor: e.provedor, existe: e.existe })),
      ...data,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config (behavior of the assistant + the Radar
 * model). Validates the provider/model with the PROVIDER'S key from
 * `cb_ia_chaves` before persisting. Keys themselves are managed in
 * Integrações (`/api/cb/ia/chaves`, 1042); `api_key` here is ignored.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const provider = body.provider as AiProvider
    if (provider !== 'openai' && provider !== 'anthropic' && provider !== 'gemini') {
      return bad('provider must be "openai", "anthropic" or "gemini"')
    }
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    // Modelo do Radar (946). Ausente ou vazio => NULL => herda `model`.
    // ⚠️ Vazio NÃO pode virar string vazia na coluna: o CHECK da 946
    // barraria, e no Gemini a URL viraria `/models/:generateContent` —
    // um 404 sem explicação, dentro do worker, de madrugada.
    const radarModelProvided = 'radar_model' in body
    const radarModel =
      typeof body.radar_model === 'string' && body.radar_model.trim()
        ? body.radar_model.trim()
        : null

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    // ⚠️ A CHAVE não passa mais por aqui (1042): ela é do PROVEDOR, uma por
    // conta, gravada em Configurações → Integrações (`/api/cb/ia/chaves`).
    // `api_key` e `embeddings_api_key` no corpo são IGNORADOS — um cliente
    // antigo em cache não consegue mais gravar na coluna que ninguém lê.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, radar_model')
      .eq('account_id', accountId)
      .is('channel_id', null)
      .maybeSingle()

    let apiKeyPlain: string
    try {
      const lida = await lerChave(accountId, provider)
      if (lida.ilegivel) {
        return NextResponse.json(
          { error: 'chave_ilegivel', code: 'chave_ilegivel' },
          { status: 400 },
        )
      }
      if (!lida.chave) {
        return NextResponse.json(
          { error: 'sem_chave', code: 'sem_chave' },
          { status: 400 },
        )
      }
      apiKeyPlain = lida.chave
    } catch (err) {
      console.error('[ai/config POST] leitura da chave falhou:', err)
      return NextResponse.json(
        { error: 'Failed to save AI configuration' },
        { status: 500 },
      )
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      provider !== existing.provider ||
      model !== existing.model

    // ⚠️ TROCA DE PROVEDOR sem `radar_model` no corpo ZERA o guardado (ele
    // volta a herdar `model`, validado logo acima) — nunca bloqueia. O
    // valor guardado é um id do provedor ANTIGO: mantê-lo faria o Radar
    // chamar o provedor novo com modelo do velho, falhando de madrugada;
    // e REJEITAR o save travaria a troca de provedor na tela de Agentes,
    // que não tem o campo e nunca o envia — um 400 sobre um campo
    // invisível. Quem quiser modelo próprio no provedor novo escolhe de
    // novo em Integrações.
    const providerMudou = !!existing && provider !== existing.provider
    const radarModelEfetivo = radarModelProvided
      ? radarModel
      : providerMudou
        ? null
        : ((existing?.radar_model as string | null) ?? null)
    // Validação paga só quando o valor efetivo é não-nulo E algo mudou de
    // verdade (o valor, o provedor por baixo dele, ou a chave).
    const radarModelMudou =
      radarModelEfetivo !== null &&
      (!existing ||
        radarModelEfetivo !== existing.radar_model ||
        providerMudou)

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          radarModel: null,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        if (err instanceof AiError) {
          // ⚠️ Nunca `err.message` cru: em `invalid_key` ele ECOA a chave
          // ("Incorrect API key provided: sk-…abcd") — e a chave validada é a
          // GUARDADA em Integrações, que quem salva aqui nem digitou. A
          // mesma exceção do save do modelo do Radar, logo abaixo (#30).
          return NextResponse.json(
            { error: mensagemSeguraDeAiError(err), code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // O modelo do Radar contra o provedor, antes de gravar. É aqui que um
    // id inválido é pego — o painel de Integrações só pinga o modelo do
    // CHAT, e o Radar só rodaria no próximo ciclo do agendador, sem
    // ninguém na tela para ler o erro.
    if (radarModelMudou) {
      try {
        await validateAiCredentials({
          provider,
          model: radarModelEfetivo,
          apiKey: apiKeyPlain,
          systemPrompt: null,
          radarModel: null,
          isActive: true,
          autoReplyEnabled: false,
          autoReplyMaxPerConversation: 3,
          handoffAgentId: null,
          embeddingsApiKey: null,
        })
      } catch (err) {
        // ⚠️ A mensagem do provedor é útil aqui (ela diz "modelo não
        // encontrado"), MENOS quando a falha é de credencial: nesse caso
        // ela ecoa a chave enviada ("Incorrect API key provided:
        // sk-…abcd") — e a chave pode ser a GUARDADA, que quem está
        // salvando nem digitou. Só o caso de chave vira texto genérico.
        const motivo =
          err instanceof AiError
            ? mensagemSeguraDeAiError(err)
            : 'erro desconhecido do provedor'
        return NextResponse.json(
          {
            error: `O modelo do Radar (${radarModelEfetivo}) não respondeu: ${motivo}`,
            code: 'radar_model_invalid',
          },
          { status: 400 },
        )
      }
    }

    const shared: Record<string, unknown> = {
      provider,
      model,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    // Mesma regra para o modelo do Radar: a tela de Agentes e a de
    // Integrações salvam campos diferentes da MESMA linha, então um save
    // que não mandou o campo não pode zerá-lo — EXCETO na troca de
    // provedor, quando o reset é deliberado (ver `providerMudou` acima).
    if (radarModelProvided) {
      shared.radar_model = radarModel
    } else if (providerMudou) {
      shared.radar_model = null
    }
    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(shared)
        .eq('account_id', accountId)
        .is('channel_id', null)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
