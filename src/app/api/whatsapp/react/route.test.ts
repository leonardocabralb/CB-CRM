import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// POST /api/whatsapp/react — o alvo da reação (Fase 11.3).
//
// A ficha só-BSUID (a Meta sem telefone) exigia telefone aqui e a reação
// morria com "Contact phone number not found". Agora:
//   · pela Meta, o alvo é o telefone ou, sem ele, o BSUID (em `recipient`,
//     pelo `recipientFields` de `meta-api.ts`);
//   · pela Evolution, a reação usa só a CHAVE da mensagem (`remote_jid`,
//     `from_me`, id) — o telefone da ficha nunca foi usado ali.
// ============================================================

const BSUID = 'BR.13491208655302741918'

const h = vi.hoisted(() => ({
  contato: null as Record<string, unknown> | null,
  canal: null as Record<string, unknown> | null,
  reacoesGravadas: [] as Record<string, unknown>[],
}))

function fakeDb() {
  return {
    from(tabela: string) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        delete: () => chain,
        maybeSingle: async () => {
          if (tabela === 'messages') {
            return {
              data: {
                id: 'msg-1',
                message_id: 'wamid.ALVO',
                conversation_id: 'conv-1',
                remote_jid: '5583988887777@s.whatsapp.net',
                from_me: false,
              },
              error: null,
            }
          }
          if (tabela === 'conversations') {
            return {
              data: { id: 'conv-1', account_id: 'acct-1', group_id: null, contact: h.contato },
              error: null,
            }
          }
          return { data: null, error: null }
        },
        upsert: async (row: Record<string, unknown>) => {
          h.reacoesGravadas.push(row)
          return { error: null }
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
      }
      return chain
    },
  }
}

vi.mock('@/lib/auth/account', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requireRole: vi.fn(async () => ({ supabase: fakeDb(), accountId: 'acct-1', userId: 'user-1' })),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response(null, { status: 429 }),
  RATE_LIMITS: { react: {} },
}))

const evolution = vi.hoisted(() => ({
  sendReaction: vi.fn(async () => ({})),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannel: vi.fn(async () => h.canal),
  evolutionTransportFor: vi.fn(() => evolution),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))

const meta = vi.hoisted(() => ({
  sendReactionMessage: vi.fn(async () => ({ messageId: 'wamid.reacao' })),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import { POST } from './route'

const CANAL_META = {
  channelId: 'canal-meta',
  provider: 'meta',
  phone_number_id: 'pn-1',
  access_token: 'enc',
}
const CANAL_EVOLUTION = {
  channelId: 'canal-evo',
  provider: 'evolution',
  base_url: 'https://evo.test',
  instance_name: 'inst',
  api_key: 'k',
}

function reagir() {
  return POST(
    new Request('http://localhost/api/whatsapp/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id: 'msg-1', emoji: '👍' }),
    }),
  )
}

beforeEach(() => {
  h.contato = { phone: null, wa_user_id: BSUID }
  h.canal = CANAL_META
  h.reacoesGravadas = []
  meta.sendReactionMessage.mockClear()
  evolution.sendReaction.mockClear()
})

describe('POST /api/whatsapp/react — o alvo (Fase 11.3)', () => {
  it('pela Meta, a ficha só-BSUID recebe a reação no BSUID', async () => {
    const res = await reagir()
    expect(res.status).toBe(200)
    expect(meta.sendReactionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: BSUID, targetMessageId: 'wamid.ALVO', emoji: '👍' }),
    )
    expect(h.reacoesGravadas).toHaveLength(1)
  })

  it('pela Meta, com telefone, o alvo continua sendo o telefone', async () => {
    h.contato = { phone: '+5583988887777', wa_user_id: BSUID }
    const res = await reagir()
    expect(res.status).toBe(200)
    expect(meta.sendReactionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '5583988887777' }),
    )
  })

  it('pela Meta, sem telefone nem BSUID: 400 e nada sai', async () => {
    h.contato = { phone: null, wa_user_id: null }
    const res = await reagir()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/no phone number or WhatsApp user ID/)
    expect(meta.sendReactionMessage).not.toHaveBeenCalled()
    expect(h.reacoesGravadas).toEqual([])
  })

  it('pela Evolution, a reação usa só a CHAVE da mensagem — o telefone da ficha não é exigido', async () => {
    h.canal = CANAL_EVOLUTION
    h.contato = { phone: null, wa_user_id: null }
    const res = await reagir()
    expect(res.status).toBe(200)
    expect(evolution.sendReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        target: {
          id: 'wamid.ALVO',
          remoteJid: '5583988887777@s.whatsapp.net',
          fromMe: false,
        },
        emoji: '👍',
      }),
    )
    expect(meta.sendReactionMessage).not.toHaveBeenCalled()
  })
})
