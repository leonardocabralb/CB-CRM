import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  mostrarDigitando: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('./digitando', async (original) => ({
  ...(await original<typeof import('./digitando')>()),
  mostrarDigitando: h.mostrarDigitando,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { PRAZO_DO_DIGITANDO_MS } from './digitando'
import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    radarModel: null,
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  }
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.retrieveKnowledge.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.mostrarDigitando.mockReset().mockResolvedValue('enviado')
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — "digitando…" (#527, Fase 9)', () => {
  it('depois de todos os portões e ANTES de gerar, com o wamid recebido', async () => {
    const ordem: string[] = []
    h.mostrarDigitando.mockImplementation(async () => {
      ordem.push('digitando')
      return 'enviado'
    })
    h.generateReply.mockImplementation(async () => {
      ordem.push('gerar')
      return { text: 'Olá!', handoff: false }
    })
    // (O dublê de banco não imita a consulta a `cb_channels` do interruptor
    // por canal — coberta em channel-scope.test.ts; aqui a entrada vem sem
    // canal, e o canal repassado é o mesmo `null`.)
    await dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    expect(h.mostrarDigitando).toHaveBeenCalledWith(expect.anything(), {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      channelId: null,
      inboundMessageId: 'wamid.X',
      sinal: expect.any(AbortSignal),
    })
    expect(ordem).toEqual(['digitando', 'gerar'])
  })

  it('portão que barra (gente atribuída, IA desligada, teto): nada de "digitando…"', async () => {
    h.state.conv = { assigned_agent_id: 'u1', ai_autoreply_disabled: false, ai_reply_count: 0 }
    await dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    h.state.conv = { assigned_agent_id: null, ai_autoreply_disabled: false, ai_reply_count: 3 }
    await dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    h.loadAiConfig.mockResolvedValueOnce(null)
    await dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    expect(h.mostrarDigitando).not.toHaveBeenCalled()
  })

  it('a falha do "digitando…" não segura a resposta', async () => {
    h.mostrarDigitando.mockResolvedValueOnce('falhou')
    await dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('⚠️ a resposta ESPERA o "digitando…" terminar: ele nunca chega depois dela (revisão do PR #288)', async () => {
    const ordem: string[] = []
    let soltar: () => void = () => {}
    h.mostrarDigitando.mockImplementation(
      () =>
        new Promise((resolve) => {
          soltar = () => {
            ordem.push('digitando terminou')
            resolve('enviado')
          }
        }),
    )
    h.engineSendText.mockImplementation(async () => {
      ordem.push('resposta saiu')
      return { whatsapp_message_id: 'm1' }
    })

    const fim = dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
    for (let i = 0; i < 20; i++) await Promise.resolve()
    expect(h.engineSendText).not.toHaveBeenCalled()

    soltar()
    await fim
    expect(ordem).toEqual(['digitando terminou', 'resposta saiu'])
  })

  it('"digitando…" que não termina: a resposta sai no prazo, e o pedido é CANCELADO', async () => {
    vi.useFakeTimers()
    try {
      let sinal: AbortSignal | undefined
      h.mostrarDigitando.mockImplementation((_db: unknown, a: { sinal?: AbortSignal }) => {
        sinal = a.sinal
        return new Promise(() => {})
      })

      const fim = dispatchInboundToAiReply({ ...ARGS, inboundMessageId: 'wamid.X' })
      await vi.advanceTimersByTimeAsync(PRAZO_DO_DIGITANDO_MS)
      await fim

      expect(h.engineSendText).toHaveBeenCalledTimes(1)
      expect(sinal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
