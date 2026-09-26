import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// Fase 11.3 — o ALVO dos envios do robô (fluxo e IA) quando a ficha só tem
// o BSUID, o identificador que a Meta manda de quem adotou nome de usuário.
//
// As quatro portas deste arquivo (texto, mídia, botões, lista) decidem o
// alvo DEPOIS de resolver o canal (`alvoDoRobo`):
//   · telefone válido vale em qualquer transporte;
//   · o BSUID só pela API oficial da Meta — pela Evolution ele viraria o
//     número formado pelos dígitos dele, um desconhecido;
//   · variantes do nono dígito e a autocorreção do telefone depois de um
//     131030 são SÓ de telefone — o BSUID jamais vai para `contacts.phone`.
// A mesma régua do remetente das automações está em
// `automations/meta-send.bsuid.test.ts`.
// ============================================================

const BSUID = 'BR.13491208655302741918'
const RECUSA_131030 = '(#131030) Recipient phone number not in allowed list'

const h = vi.hoisted(() => ({
  contato: null as Record<string, unknown> | null,
  canal: null as Record<string, unknown> | null,
  mensagens: [] as Record<string, unknown>[],
  contatosAtualizados: [] as Record<string, unknown>[],
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      const filtros: [string, unknown][] = []
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => (filtros.push([k, v]), chain),
        maybeSingle: async () => {
          if (tabela === 'contacts') return { data: h.contato, error: null }
          if (tabela === 'conversations') {
            return { data: { id: filtros.find(([k]) => k === 'id')?.[1] }, error: null }
          }
          return { data: null, error: null }
        },
        insert: (row: Record<string, unknown>) => {
          h.mensagens.push(row)
          return { select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) }
        },
        update: (row: Record<string, unknown>) => {
          if (tabela === 'contacts') h.contatosAtualizados.push(row)
          return chain
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      }
      return chain
    },
  }),
}))

const evolution = vi.hoisted(() => ({
  sendText: vi.fn(async () => ({ providerMessageId: 'evo.t' })),
  sendMedia: vi.fn(async () => ({ providerMessageId: 'evo.m' })),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => h.canal),
  evolutionTransportFor: vi.fn(() => evolution),
  evolutionRemoteJid: vi.fn((to: string) => `${to}@s.whatsapp.net`),
}))
vi.mock('@/lib/cb-channels/stamp', () => ({ stampMessageChannel: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/assinatura/resolver', () => ({ nomeAutomaticoParaAssinar: vi.fn(async () => null) }))

const meta = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
  engineSendMedia,
  engineSendText,
} from './meta-send'

const BASE = { accountId: 'acc-1', userId: 'u-1', conversationId: 'conv-1', contactId: 'contact-1' }

const CANAL_META = {
  channelId: 'canal-meta',
  kind: 'meta',
  provider: 'meta',
  phone_number_id: 'pn-1',
  access_token: 'enc',
}
const CANAL_EVOLUTION = {
  channelId: 'canal-evo',
  kind: 'evolution',
  provider: 'evolution',
  base_url: 'https://evo.test',
  instance_name: 'inst',
  api_key: 'k',
}

type Envio = {
  nome: string
  enviar: () => Promise<unknown>
  provedor: ReturnType<typeof vi.fn>
  /** Botões e lista não existem na Evolution: ela recusa por outro motivo. */
  evolution: 'envia' | 'nao_existe'
}

const ENVIOS: Envio[] = [
  {
    nome: 'texto',
    enviar: () => engineSendText({ ...BASE, text: 'oi' }),
    provedor: meta.sendTextMessage,
    evolution: 'envia',
  },
  {
    nome: 'mídia',
    enviar: () => engineSendMedia({ ...BASE, kind: 'image', link: 'https://x.test/a.jpg' }),
    provedor: meta.sendMediaMessage,
    evolution: 'envia',
  },
  {
    nome: 'botões',
    enviar: () =>
      engineSendInteractiveButtons({ ...BASE, bodyText: 'Escolha', buttons: [{ id: 'a', title: 'A' }] }),
    provedor: meta.sendInteractiveButtons,
    evolution: 'nao_existe',
  },
  {
    nome: 'lista',
    enviar: () =>
      engineSendInteractiveList({
        ...BASE,
        bodyText: 'Escolha',
        buttonLabel: 'Ver',
        sections: [{ rows: [{ id: 'x', title: 'X' }] }],
      }),
    provedor: meta.sendInteractiveList,
    evolution: 'nao_existe',
  },
]

beforeEach(() => {
  h.contato = { id: 'contact-1', phone: null, wa_user_id: BSUID }
  h.canal = CANAL_META
  h.mensagens = []
  h.contatosAtualizados = []
  for (const f of Object.values(meta)) {
    f.mockReset()
    f.mockResolvedValue({ messageId: 'wamid.ok' })
  }
  evolution.sendText.mockClear()
  evolution.sendMedia.mockClear()
})

describe('robô (fluxo e IA): o alvo por BSUID', () => {
  for (const e of ENVIOS) {
    it(`${e.nome}: pela Meta, a ficha só-BSUID recebe no BSUID, uma vez, sem tocar em contacts`, async () => {
      await e.enviar()
      expect(e.provedor).toHaveBeenCalledTimes(1)
      expect(e.provedor).toHaveBeenCalledWith(expect.objectContaining({ to: BSUID }))
      expect(h.contatosAtualizados).toEqual([])
      expect(h.mensagens).toHaveLength(1)
    })

    it(`${e.nome}: 131030 com BSUID — UMA tentativa, sem variantes, sem autocorreção`, async () => {
      e.provedor.mockRejectedValue(new Error(RECUSA_131030))
      await expect(e.enviar()).rejects.toThrow(/131030/)
      expect(e.provedor).toHaveBeenCalledTimes(1)
      expect(h.contatosAtualizados).toEqual([])
      expect(h.mensagens).toEqual([])
    })

    it(`${e.nome}: com telefone E BSUID, o telefone é o alvo`, async () => {
      h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: BSUID }
      await e.enviar()
      expect(e.provedor).toHaveBeenCalledWith(expect.objectContaining({ to: '5583988887777' }))
    })

    it(`${e.nome}: 131030 com TELEFONE — as variantes rodam e a que entrega corrige a ficha`, async () => {
      // Controle positivo: a autocorreção continua viva para telefone.
      h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: null }
      e.provedor.mockRejectedValueOnce(new Error(RECUSA_131030))
      await e.enviar()
      expect(e.provedor.mock.calls.length).toBeGreaterThan(1)
      const variante = (e.provedor.mock.calls[1]?.[0] as { to: string }).to
      expect(variante).not.toBe('5583988887777')
      expect(h.contatosAtualizados).toEqual([{ phone: variante }])
    })

    it(`${e.nome}: pela Evolution, a ficha só-BSUID é recusada sem chamar ninguém`, async () => {
      h.canal = CANAL_EVOLUTION
      await expect(e.enviar()).rejects.toThrow(
        e.evolution === 'envia' ? /only an official Meta number/ : /not supported on the Evolution/,
      )
      expect(evolution.sendText).not.toHaveBeenCalled()
      expect(evolution.sendMedia).not.toHaveBeenCalled()
      expect(e.provedor).not.toHaveBeenCalled()
      expect(h.mensagens).toEqual([])
    })
  }

  it('texto pela Evolution com telefone E BSUID: sai pelo TELEFONE', async () => {
    h.canal = CANAL_EVOLUTION
    h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: BSUID }
    await engineSendText({ ...BASE, text: 'oi' })
    expect(evolution.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: '5583988887777' }))
    expect(h.mensagens[0]?.remote_jid).toBe('5583988887777@s.whatsapp.net')
  })

  it('mídia pela Evolution com telefone: sai pelo TELEFONE', async () => {
    h.canal = CANAL_EVOLUTION
    h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: null }
    await engineSendMedia({ ...BASE, kind: 'image', link: 'https://x.test/a.jpg' })
    expect(evolution.sendMedia).toHaveBeenCalledWith(expect.objectContaining({ to: '5583988887777' }))
  })

  it('ficha sem telefone e sem BSUID (a do Instagram) falha com o motivo, sem provedor', async () => {
    h.contato = { id: 'contact-1', phone: null, wa_user_id: null }
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/Instagram-only contact/)
    expect(meta.sendTextMessage).not.toHaveBeenCalled()
  })

  it('telefone inválido sem BSUID falha com o motivo, sem provedor', async () => {
    h.contato = { id: 'contact-1', phone: '123', wa_user_id: null }
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/contact phone invalid: 123/)
    expect(meta.sendTextMessage).not.toHaveBeenCalled()
  })

  it('contato inexistente continua "contact not found"', async () => {
    h.contato = null
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/contact not found for this account/)
  })
})
