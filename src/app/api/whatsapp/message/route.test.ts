import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// DELETE/PATCH /api/whatsapp/message — o ENDEREÇO da revogação (19/10/2026).
//
// Até aqui o envio pelo CRM gravava em `remote_jid` o telefone da FICHA, e a
// Evolution manda para o endereço que existe no WhatsApp (o número antigo de
// DDD 31 em diante vive SEM o 9). O apagar usa o JID cru: com a grafia da
// ficha, a revogação ia para uma conversa que não existe, a Evolution
// respondia 2xx e a mensagem seguia no aparelho do cliente. A rota troca
// pela grafia que o CLIENTE usa na conversa — só quando é a outra grafia do
// MESMO número. Números fictícios.
// ============================================================

const COM_9 = '5583988887777@s.whatsapp.net'
const SEM_9 = '558388887777@s.whatsapp.net'

const h = vi.hoisted(() => ({
  alvo: {} as Record<string, unknown>,
  doCliente: null as { remote_jid: string } | null,
  erroDoCliente: null as { message: string } | null,
  leiturasDoCliente: 0,
}))

/** Cliente da SESSÃO: a mensagem-alvo (por id) e a última do cliente. */
function sessao() {
  return {
    from(tabela: string) {
      const filtros: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor
          return chain
        },
        like: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => {
          if (tabela !== 'messages') return { data: null, error: null }
          if ('id' in filtros) return { data: h.alvo, error: null }
          h.leiturasDoCliente++
          return { data: h.doCliente, error: h.erroDoCliente }
        },
      }
      return chain
    },
  }
}

/** Service role: as marcas do pedido. Toda escrita dá certo. */
function servico() {
  const chain: Record<string, unknown> = {
    from: () => chain,
    update: () => chain,
    eq: () => chain,
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
  }
  return chain
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => servico() }))

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireRole: vi.fn(async () => ({ supabase: sessao(), accountId: 'acct-1', userId: 'user-1' })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { react: {} },
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => ({
    channelId: 'canal-evo',
    provider: 'evolution',
    kind: 'evolution',
    base_url: 'https://evo.test',
    instance_name: 'inst',
    api_key: 'k',
  })),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/inbox/conversation-preview', () => ({ atualizarPreviaDaConversa: vi.fn(async () => {}) }))

const evolution = vi.hoisted(() => ({
  deleteMessageForEveryone: vi.fn(async (key: { id: string }) => ({
    message: { protocolMessage: { key: { id: key.id } } },
  })),
  updateMessage: vi.fn(async () => {}),
}))
vi.mock('@/lib/whatsapp/transport/evolution-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  EvolutionClient: class {
    deleteMessageForEveryone = evolution.deleteMessageForEveryone
    updateMessage = evolution.updateMessage
  },
}))

import { DELETE, PATCH } from './route'

function pedir(metodo: 'DELETE' | 'PATCH', corpo: Record<string, unknown>) {
  const req = new Request('http://localhost/api/whatsapp/message', {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  return metodo === 'DELETE' ? DELETE(req) : PATCH(req)
}

beforeEach(() => {
  h.alvo = {
    id: 'msg-1',
    message_id: '3EB0ALVO',
    sender_type: 'bot',
    content_text: 'oi',
    created_at: new Date().toISOString(),
    conversation_id: 'conv-1',
    remote_jid: COM_9,
    remote_jid_lid: null,
    deleted_at: null,
    delete_requested_at: null,
    channel_id: 'canal-evo',
    from_me: true,
  }
  h.doCliente = { remote_jid: SEM_9 }
  h.erroDoCliente = null
  h.leiturasDoCliente = 0
  evolution.deleteMessageForEveryone.mockClear()
  evolution.updateMessage.mockClear()
})

describe('DELETE: revoga no endereço onde a mensagem vive', () => {
  it('gravada com o 9 e o cliente escreve sem: revoga SEM o 9 (o caso de 19/10/2026)', async () => {
    const res = await pedir('DELETE', { message_id: 'msg-1' })
    expect(res?.status).toBe(200)
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith({
      id: '3EB0ALVO',
      remoteJid: SEM_9,
      fromMe: true,
    })
  })

  it('a mesma grafia dos dois lados: nada muda', async () => {
    h.doCliente = { remote_jid: COM_9 }
    await pedir('DELETE', { message_id: 'msg-1' })
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith(
      expect.objectContaining({ remoteJid: COM_9 }),
    )
  })

  it('o cliente com OUTRO número: fica o gravado (nunca a conversa de outro)', async () => {
    h.doCliente = { remote_jid: '558388881111@s.whatsapp.net' }
    await pedir('DELETE', { message_id: 'msg-1' })
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith(
      expect.objectContaining({ remoteJid: COM_9 }),
    )
  })

  it('o cliente nunca escreveu: fica o gravado', async () => {
    h.doCliente = null
    await pedir('DELETE', { message_id: 'msg-1' })
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith(
      expect.objectContaining({ remoteJid: COM_9 }),
    )
  })

  it('leitura do cliente que falha: fica o gravado, e o pedido segue', async () => {
    h.doCliente = null
    h.erroDoCliente = { message: 'timeout' }
    const res = await pedir('DELETE', { message_id: 'msg-1' })
    expect(res?.status).toBe(200)
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith(
      expect.objectContaining({ remoteJid: COM_9 }),
    )
  })

  it('com LID gravado: revoga pelo LID, sem ler o cliente', async () => {
    h.alvo.remote_jid_lid = '100000000000102@lid'
    await pedir('DELETE', { message_id: 'msg-1' })
    expect(h.leiturasDoCliente).toBe(0)
    expect(evolution.deleteMessageForEveryone).toHaveBeenCalledWith(
      expect.objectContaining({ remoteJid: '100000000000102@lid' }),
    )
  })
})

describe('PATCH: edita no mesmo endereço', () => {
  it('número e chave saem na grafia do cliente', async () => {
    const res = await pedir('PATCH', { message_id: 'msg-1', text: 'oi de novo' })
    expect(res?.status).toBe(200)
    expect(evolution.updateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        number: '558388887777',
        key: expect.objectContaining({ remoteJid: SEM_9 }),
      }),
    )
  })
})
