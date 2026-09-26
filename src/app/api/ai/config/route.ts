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
import { hasMinRole } from '@/lib/auth/roles'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { encrypt } from '@/lib/whatsapp/encryption'

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
 *
 * ⚠️ O `system_prompt` só sai para ADMINISTRADOR (D14 do
 * docs/PLANO-agentes-de-ia.md: o prompt fica oculto para quem não é — a tela
 * esconde, e a rota tem de esconder junto; Codex, #295).
 */
export async function GET() {
  try {
    const { accountId, role } = await getCurrentAccount()

    // ⚠️ Pelo SERVIÇO, com a conta da sessão: a faixa de IA da conversa
    // chama esta rota para qualquer membro, e quem decide o que sai é o papel,
    // logo abaixo. A regra de LEITURA de `ai_configs` só vira "só
    // administrador" na 1048 (a fase seguinte, F1b), aplicada DEPOIS do deploy
    // desta rota: fechá-la antes quebraria, na janela, a leitura pelo cliente
    // da sessão que o app anterior faz (config e rascunho). Até a 1048, a
    // leitura direta pelo PostgREST é a de sempre (0029) — nada piora aqui.
    const { data, error } = await supabaseAdmin()
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

    // ⚠️ As chaves moram em `cb_ia_chaves` desde a 1047, uma por provedor
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
    // A busca por sentido existe com a chave da OpenAI — MENOS a que a
    // OpenAI recusou para embeddings ao ser gravada (chave restrita), a não
    // ser que haja a chave PRÓPRIA dos embeddings herdada da 1047.
    const embeddingsUtilizavel = estado.some(
      (e) =>
        e.provedor === 'openai' &&
        e.existe &&
        (e.temChaveDeEmbeddings || e.serveEmbeddings !== false),
    )

    if (!data) {
      return NextResponse.json({
        configured: false,
        has_embeddings_key: embeddingsUtilizavel,
        chaves: estado.map((e) => ({ provedor: e.provedor, existe: e.existe })),
      })
    }
    const { system_prompt, ...semPrompt } = data
    return NextResponse.json({
      configured: true,
      has_key: temChave(data.provider as string),
      has_embeddings_key: embeddingsUtilizavel,
      chaves: estado.map((e) => ({ provedor: e.provedor, existe: e.existe })),
      ...semPrompt,
      ...(hasMinRole(role, 'admin') ? { system_prompt } : {}),
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
 * Integrações (`/api/cb/ia/chaves`, 1047); `api_key` here is ignored.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    // ⚠️ Aba ABERTA do app anterior à 1047 manda a chave aqui. Ignorá-la e
    // responder "salvo" faria a pessoa revogar a chave antiga achando que a
    // nova ficou (Codex, #294): recusa pedindo para recarregar — a chave agora
    // se cadastra em Configurações → Integrações.
    const temChave = (v: unknown) => typeof v === 'string' && v.trim() !== ''
    if (temChave(body.api_key) || temChave(body.embeddings_api_key) || body.embeddings_api_key === null) {
      return NextResponse.json(
        {
          error: 'Esta página está desatualizada: recarregue e cadastre a chave em Configurações → Integrações.',
          code: 'tela_desatualizada',
        },
        { status: 409 },
      )
    }

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

    // ⚠️ A CHAVE não passa mais por aqui (1047): ela é do PROVEDOR, uma por
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
      // A chave da OpenAI marcada SÓ DA BASE (gera embedding, não gera texto)
      // não liga o assistente: rascunho, Playground e resposta automática
      // falhariam em toda geração. Ligar só muda o interruptor e pula a
      // validação paga abaixo, então a marca é conferida aqui (Codex, #295).
      if (provider === 'openai' && (isActive || autoReplyEnabled)) {
        const estado = await lerEstado(accountId)
        if (estado.find((e) => e.provedor === 'openai')?.soDaBase) {
          return NextResponse.json(
            { error: 'provedor_so_da_base', code: 'provedor_so_da_base' },
            { status: 400 },
          )
        }
      }
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
      // ⚠️ Na TROCA de provedor, a cópia legada da chave (só para voltar atrás
      // do deploy, 1047) passa a ser a do provedor NOVO: sem isso a volta
      // atrás chamaria o provedor novo com a chave do antigo (Codex, #294).
      ...(providerMudou ? { api_key: encrypt(apiKeyPlain) } : {}),
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
    // ⚠️ A gravação vai pelo SERVIÇO, com a conta escrita no filtro: o
    // gatilho da janela da 1047 trata escrita do NAVEGADOR como vinda do app
    // anterior e copiaria a `api_key` do espelho de volta para `cb_ia_chaves`
    // com `serve_embeddings` nulo — apagando o "esta chave não serve à base"
    // já conferido (Codex, #294).
    const db = supabaseAdmin()
    if (existing) {
      const { error: upErr } = await db
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
      const { error: insErr } = await db.from('ai_configs').insert({
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
