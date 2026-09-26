import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// Fase 11.3 — o alvo por BSUID no remetente REAL das automações.
//
// `sendViaMeta` (este `meta-send.ts`) é quem manda `send_message`,
// `send_template` e `send_to_number` — e a régua do Asaas. Uma versão da
// regra o chamava de "só um wrapper"; só botão e lista delegam para
// `flows/meta-send.ts`. Por isso este arquivo existe: corrigir só o remetente
// dos fluxos deixaria a automação mandando o BSUID à Evolution (as letras
// sumiriam e a mensagem iria ao número formado pelos dígitos dele) e
// gravando o BSUID em `contacts.phone` depois de um 131030.
// ============================================================

const BSUID = 'BR.13491208655302741918'
const RECUSA_131030 = '(#131030) Recipient phone number not in allowed list'

const h = vi.hoisted(() => ({
  contato: null as Record<string, unknown> | null,
  canal: null as Record<string, unknown> | null,
  mensagens: [] as Record<string, unknown>[],
  contatosAtualizados: [] as Record<string, unknown>[],
  /** A linha local do modelo (`resolveTemplateRow`); nula = sem linha. */
  modelo: null as Record<string, unknown> | null,
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
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => h.canal),
  evolutionTransportFor: vi.fn(() => evolution),
  evolutionRemoteJid: vi.fn((to: string) => `${to}@s.whatsapp.net`),
}))
vi.mock('@/lib/cb-channels/stamp', () => ({ stampMessageChannel: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/assinatura/resolver', () => ({
  nomeAutomaticoParaAssinar: vi.fn(async () => null),
  nomePersonalizadoParaAssinar: vi.fn(async () => null),
}))
vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: vi.fn(async () => ({ row: h.modelo, malformed: false, language: 'pt_BR' })),
  templateContentText: vi.fn(() => null),
}))

const meta = vi.hoisted(() => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)
// Botão e lista delegam para os fluxos (coberto em `meta-send.test.ts`).
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}))

import { engineSendTemplate, engineSendText } from './meta-send'

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

const ENVIOS = [
  { nome: 'send_message', enviar: () => engineSendText({ ...BASE, text: 'oi' }), provedor: meta.sendTextMessage },
  {
    nome: 'send_template',
    enviar: () => engineSendTemplate({ ...BASE, templateName: 'aviso', language: 'pt_BR' }),
    provedor: meta.sendTemplateMessage,
  },
]

beforeEach(() => {
  h.contato = { id: 'contact-1', phone: null, wa_user_id: BSUID }
  h.canal = CANAL_META
  h.mensagens = []
  h.contatosAtualizados = []
  h.modelo = null
  for (const f of Object.values(meta)) {
    f.mockReset()
    f.mockResolvedValue({ messageId: 'wamid.ok' })
  }
  evolution.sendText.mockClear()
})

describe('automação (sendViaMeta): o alvo por BSUID', () => {
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
    })

    it(`${e.nome}: 131030 com TELEFONE — as variantes rodam e a que entrega corrige a ficha`, async () => {
      h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: null }
      e.provedor.mockRejectedValueOnce(new Error(RECUSA_131030))
      await e.enviar()
      const variante = (e.provedor.mock.calls[1]?.[0] as { to: string }).to
      expect(variante).not.toBe('5583988887777')
      expect(h.contatosAtualizados).toEqual([{ phone: variante }])
    })
  }

  it('send_message pela Evolution: a ficha só-BSUID é recusada sem chamar o transporte', async () => {
    h.canal = CANAL_EVOLUTION
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/only an official Meta number/)
    expect(evolution.sendText).not.toHaveBeenCalled()
    expect(meta.sendTextMessage).not.toHaveBeenCalled()
    expect(h.mensagens).toEqual([])
  })

  it('send_message pela Evolution com telefone E BSUID: sai pelo TELEFONE', async () => {
    h.canal = CANAL_EVOLUTION
    h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: BSUID }
    await engineSendText({ ...BASE, text: 'oi' })
    expect(evolution.sendText).toHaveBeenCalledWith(expect.objectContaining({ to: '5583988887777' }))
    expect(h.mensagens[0]?.remote_jid).toBe('5583988887777@s.whatsapp.net')
  })

  it('send_template pela Evolution continua recusado pelo motivo de sempre', async () => {
    h.canal = CANAL_EVOLUTION
    await expect(
      engineSendTemplate({ ...BASE, templateName: 'aviso', language: 'pt_BR' }),
    ).rejects.toThrow(/templates are not supported on the Evolution/)
    expect(evolution.sendText).not.toHaveBeenCalled()
  })

  it('send_template: modelo de AUTENTICAÇÃO a quem só tem BSUID é recusado antes da Meta', async () => {
    // A doc da Meta sobre BSUID exclui o código de acesso do envio por
    // `recipient`: só vai a telefone.
    h.modelo = { name: 'codigo', category: 'Authentication' }
    await expect(
      engineSendTemplate({ ...BASE, templateName: 'codigo', language: 'pt_BR' }),
    ).rejects.toThrow(/authentication templates/)
    expect(meta.sendTemplateMessage).not.toHaveBeenCalled()
    expect(h.mensagens).toEqual([])
  })

  it('send_template: modelo de AUTENTICAÇÃO a quem TEM telefone sai pelo telefone', async () => {
    h.modelo = { name: 'codigo', category: 'Authentication' }
    h.contato = { id: 'contact-1', phone: '+5583988887777', wa_user_id: BSUID }
    await engineSendTemplate({ ...BASE, templateName: 'codigo', language: 'pt_BR' })
    expect(meta.sendTemplateMessage).toHaveBeenCalledWith(expect.objectContaining({ to: '5583988887777' }))
  })

  it('ficha sem telefone e sem BSUID (a do Instagram) falha com o motivo', async () => {
    h.contato = { id: 'contact-1', phone: null, wa_user_id: null }
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/Instagram-only contact/)
    expect(meta.sendTextMessage).not.toHaveBeenCalled()
  })

  it('contato inexistente continua "contact not found"', async () => {
    h.contato = null
    await expect(engineSendText({ ...BASE, text: 'oi' })).rejects.toThrow(/contact not found for this account/)
  })
})
