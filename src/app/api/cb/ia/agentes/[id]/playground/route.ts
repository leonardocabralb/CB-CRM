import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { AiError, mensagemSeguraDeAiError, type ChatMessage } from '@/lib/ai/types'
import { lerChave, lerEstado } from '@/lib/ia-chaves/repo'
import { obterAgente } from '@/lib/ia-agentes/repo'
import { montarPedidoDoAgente } from '@/lib/ia-agentes/pedido'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'

// O transcrito testado fica limitado, como a janela real do contexto.
const MAX_TURNOS = 20

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/cb/ia/agentes/[id]/playground  `{ messages }`  (admin, D14)
 *
 * Conversa de TESTE com um agente, sem WhatsApp: o mesmo pedido
 * (`montarPedidoDoAgente`: texto-base, data e hora, instruções e regras) e o
 * mesmo provedor/modelo que a produção vai usar. O agente pode estar
 * desligado — é para isso que o Playground existe. O gasto é gravado como
 * `agente_teste` (D13), separado do de produção.
 */
export async function POST(request: Request, { params }: Contexto) {
  try {
    const ctx = await requireRole('admin')
    const limite = checkRateLimit(`cb:ia-playground:${ctx.userId}`, RATE_LIMITS.aiDraft)
    if (!limite.success) return rateLimitResponse(limite)
    // E o teto da CONTA, como o rascunho: vários administradores testando ao
    // mesmo tempo gastam a mesma chave.
    const daConta = checkRateLimit(`cb:ia-playground-conta:${ctx.accountId}`, RATE_LIMITS.aiDraftAccount)
    if (!daConta.success) return rateLimitResponse(daConta)

    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    const agente = await obterAgente(ctx.accountId, id)
    if (!agente || agente.arquivadoEm) {
      return NextResponse.json({ error: 'nao_encontrado', code: 'nao_encontrado' }, { status: 404 })
    }

    const corpo = (await request.json().catch(() => null)) as { messages?: unknown } | null
    const brutas = Array.isArray(corpo?.messages) ? corpo.messages : null
    if (!brutas) return NextResponse.json({ error: 'sem_mensagens', code: 'sem_mensagens' }, { status: 400 })
    const mensagens: ChatMessage[] = brutas
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNOS)
    if (mensagens.length === 0 || mensagens[mensagens.length - 1].role !== 'user') {
      return NextResponse.json({ error: 'sem_mensagens', code: 'sem_mensagens' }, { status: 400 })
    }

    let chave: string | null
    try {
      // A chave da OpenAI que é SÓ da base (1042) não serve ao chat (Codex, #295).
      if (agente.provedor === 'openai') {
        const estado = await lerEstado(ctx.accountId)
        if (estado.find((e) => e.provedor === 'openai')?.soDaBase) {
          return NextResponse.json({ error: 'provedor_so_da_base', code: 'provedor_so_da_base' }, { status: 400 })
        }
      }
      const lida = await lerChave(ctx.accountId, agente.provedor)
      if (lida.ilegivel) {
        return NextResponse.json({ error: 'chave_ilegivel', code: 'chave_ilegivel' }, { status: 400 })
      }
      chave = lida.chave
    } catch (err) {
      console.error('[ia-playground] leitura da chave falhou:', err)
      return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
    }
    if (!chave) {
      return NextResponse.json({ error: 'sem_chave', code: 'sem_chave' }, { status: 400 })
    }

    const pedido = montarPedidoDoAgente({
      instrucoes: agente.instrucoes,
      regras: agente.regras,
      agora: new Date(),
    })
    const resultado = await generateReply({
      config: {
        provider: agente.provedor,
        model: agente.modelo,
        radarModel: null,
        apiKey: chave,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: agente.tetoRespostas,
        handoffAgentId: null,
        embeddingsApiKey: null,
      },
      systemPrompt: pedido,
      messages: mensagens,
    })

    // O gasto JÁ aconteceu na chave da conta: registrar antes de responder.
    await logAiUsage(supabaseAdmin(), {
      accountId: ctx.accountId,
      conversationId: null,
      mode: 'agente_teste',
      provider: agente.provedor,
      model: agente.modelo,
      usage: resultado.usage,
      iaAgenteId: agente.id,
      iaAgenteNome: agente.nome,
    })

    return NextResponse.json({
      reply: resultado.text,
      handoff: resultado.handoff,
      usage: resultado.usage,
    })
  } catch (err) {
    if (err instanceof AiError) {
      // `invalid_key` ecoa a chave na mensagem do provedor — nunca cru.
      return NextResponse.json(
        { error: mensagemSeguraDeAiError(err), code: err.code },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 },
      )
    }
    return respostaDoErro(err) ?? toErrorResponse(err)
  }
}
