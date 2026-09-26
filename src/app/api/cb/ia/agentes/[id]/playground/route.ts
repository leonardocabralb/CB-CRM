import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { generateReply } from '@/lib/ai/generate'
import { logAiUsage } from '@/lib/ai/usage'
import { AiError, mensagemSeguraDeAiError, type ChatMessage } from '@/lib/ai/types'
import { lerChave, lerEstado } from '@/lib/ia-chaves/repo'
import { blocoIndisponivel, lerOQueOAgenteVe } from '@/lib/ia-agentes/acesso'
import { consultaDaUltimaMensagem } from '@/lib/ia-agentes/conhecimento'
import { obterAgente } from '@/lib/ia-agentes/repo'
import { lerPassagem, montarPedidoDoAgente } from '@/lib/ia-agentes/pedido'
import { respostaDoErro } from '@/lib/ia-agentes/resposta'

// O transcrito testado fica limitado, como a janela real do contexto.
const MAX_TURNOS = 20

type Contexto = { params: Promise<{ id: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/cb/ia/agentes/[id]/playground  `{ messages, contactId? }`  (admin, D14)
 *
 * Conversa de TESTE com um agente, sem WhatsApp: o mesmo pedido
 * (`montarPedidoDoAgente`: texto-base, data e hora, instruções, regras,
 * passagens, os blocos de acesso e a base do agente) e o mesmo
 * provedor/modelo que a produção vai usar. O agente pode estar desligado — é
 * para isso que o Playground existe. O gasto é gravado como `agente_teste`
 * (D13), separado do de produção.
 *
 * F3: com `contactId` (um contato DESTA conta; fora dela, 404
 * `contato_nao_encontrado`), os blocos de acesso são os daquele contato — o
 * negócio é o card ABERTO mais recente dele. A base do agente entra sempre.
 * A resposta diz o que o agente viu: `vistos: { blocos, trechos }` — os
 * TRECHOS da base, não os documentos (5 trechos de 1 documento são 5).
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

    const corpo = (await request.json().catch(() => null)) as { messages?: unknown; contactId?: unknown } | null
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

    // O contato do teste (F3): conferido NA CONTA — o cliente de serviço
    // ignora a RLS, e um id de outra conta mostraria a ficha de outro
    // escritório ao modelo.
    let contactId: string | null = null
    if (corpo?.contactId !== undefined && corpo.contactId !== null && corpo.contactId !== '') {
      const naoEncontrado = () =>
        NextResponse.json({ error: 'contato_nao_encontrado', code: 'contato_nao_encontrado' }, { status: 404 })
      if (typeof corpo.contactId !== 'string' || !UUID.test(corpo.contactId)) return naoEncontrado()
      const { data: contato, error: erroDoContato } = await supabaseAdmin()
        .from('contacts')
        .select('id')
        .eq('account_id', ctx.accountId)
        .eq('id', corpo.contactId)
        .maybeSingle()
      if (erroDoContato) {
        console.error('[ia-playground] leitura do contato falhou:', erroDoContato.message)
        return NextResponse.json({ error: 'banco', code: 'banco' }, { status: 500 })
      }
      if (!contato) return naoEncontrado()
      contactId = corpo.contactId
    }

    let chave: string | null
    try {
      // A chave da OpenAI que é SÓ da base (1047) não serve ao chat (Codex, #295).
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

    // Os agentes para quem este pode PASSAR (D25), como o turno os mostra ao
    // modelo — menos o recorte pela conexão do turno, que o Playground não tem.
    // Sem eles, a triagem testada aqui nunca veria o bloco que a produção manda.
    const lidos = await Promise.all(
      agente.podePassarPara.map((idDoDestino) => obterAgente(ctx.accountId, idDoDestino).catch(() => null)),
    )
    const opcoes = lidos.filter((a): a is NonNullable<typeof a> => !!a && a.ativo && !a.arquivadoEm)

    // O que o agente vê (F3), pela MESMA leitura do turno.
    const agora = new Date()
    const visto = await lerOQueOAgenteVe(supabaseAdmin(), {
      accountId: ctx.accountId,
      agente,
      contactId,
      dealId: null,
      consulta: consultaDaUltimaMensagem(mensagens),
      agora,
    })

    const pedido = montarPedidoDoAgente({
      instrucoes: agente.instrucoes,
      regras: agente.regras,
      agora,
      passagens: opcoes.map((a) => ({ nome: a.nome, descricao: a.descricao })),
      blocos: visto.blocos,
      conhecimento: visto.trechos.map((t) => t.content),
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

    // A régua do turno: a transferência vence a passagem, o marcador nunca é
    // mostrado como resposta, e passar para um número que não existe transfere.
    const n = resultado.handoff ? null : lerPassagem(resultado.text)
    const destino = n === null ? null : (opcoes[n - 1] ?? null)
    return NextResponse.json({
      reply: n === null ? resultado.text : '',
      handoff: resultado.handoff || (n !== null && !destino),
      passaPara: destino?.nome ?? null,
      usage: resultado.usage,
      // Bloco que saiu "indisponível" não foi VISTO (revisão da F3).
      vistos: {
        blocos: visto.blocos.filter((b) => !blocoIndisponivel(b)).map((b) => b.bloco),
        trechos: visto.trechos.length,
      },
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
