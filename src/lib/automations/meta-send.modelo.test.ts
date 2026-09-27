import { describe, it, expect, beforeEach, vi } from 'vitest'

// ============================================================
// O remetente do passo "Enviar modelo" com os valores estruturados (Fase 2.3
// do plano do previdenciário).
//
// Duas coisas que só este arquivo enxerga, porque só o remetente conhece a
// LINHA do modelo (ela depende do canal de saída):
//   - com os valores, o envio vai COM a linha — é o que leva à Meta o
//     cabeçalho de mídia guardado e os botões;
//   - valor que o modelo pede e ficou vazio é recusado AQUI, com a frase do
//     registro, antes de a Meta ser chamada.
// ============================================================

const h = vi.hoisted(() => ({
  mensagens: [] as Record<string, unknown>[],
  linha: null as Record<string, unknown> | null,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      if (tabela === 'contacts') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: { id: 'contact-1', phone: '+5511999998888' },
            error: null,
          }),
        }
        return chain
      }
      if (tabela === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            h.mensagens.push(row)
            return { select: () => ({ single: async () => ({ data: { id: 'msg-1' }, error: null }) }) }
          },
        }
      }
      if (tabela === 'conversations') {
        const chain: Record<string, unknown> = {
          select: () => chain,
          update: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: { id: 'conv-1' }, error: null }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok),
        }
        return chain
      }
      throw new Error(`tabela inesperada: ${tabela}`)
    },
  }),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({
  resolveEngineChannelPreferring: vi.fn(async () => ({
    channelId: 'canal-1',
    provider: 'meta',
    phone_number_id: 'pn-1',
    access_token: 'enc',
  })),
  evolutionTransportFor: vi.fn(),
  evolutionRemoteJid: vi.fn(() => null),
}))
vi.mock('@/lib/cb-channels/stamp', () => ({ stampMessageChannel: vi.fn(async () => {}) }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))

const sendTemplateMessage = vi.fn<(args: Record<string, unknown>) => Promise<{ messageId: string }>>(
  async () => ({ messageId: 'wamid.tpl' })
)
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: (a: Record<string, unknown>) => sendTemplateMessage(a),
}))
vi.mock('@/lib/assinatura/resolver', () => ({
  nomeAutomaticoParaAssinar: vi.fn(async () => 'CB Advogados'),
}))
vi.mock('@/lib/whatsapp/template-body', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/template-body')>()),
  resolveTemplateRow: vi.fn(async () => ({ row: h.linha, malformed: false, language: 'pt_BR' })),
}))

import { engineSendTemplate } from './meta-send'

const LINHA = {
  id: 't1',
  user_id: 'u1',
  name: 'contrato_assinado',
  category: 'Utility',
  language: 'pt_BR',
  status: 'APPROVED',
  header_type: 'image',
  header_media_url: 'https://cdn.test/boas-vindas.png',
  body_text: 'Olá {{1}}, recebemos a assinatura.',
  created_at: '2026-09-01T00:00:00Z',
}

const ARGS = {
  accountId: 'acc-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  templateName: 'contrato_assinado',
  language: 'pt_BR',
}

beforeEach(() => {
  h.mensagens = []
  h.linha = { ...LINHA }
  sendTemplateMessage.mockClear()
})

describe('engineSendTemplate — valores estruturados (Fase 2.3)', () => {
  it('manda a LINHA do modelo junto — é ela que leva o cabeçalho de mídia guardado', async () => {
    await engineSendTemplate({ ...ARGS, params: ['Joana'], messageParams: { body: ['Joana'] } })
    const enviado = sendTemplateMessage.mock.calls[0]?.[0]
    expect(enviado?.template).toMatchObject({ name: 'contrato_assinado', header_type: 'image' })
    expect(enviado?.messageParams).toEqual({ body: ['Joana'] })
    // E o fio grava o corpo substituído — o que o cliente leu.
    expect(h.mensagens[0]?.content_text).toBe('Olá Joana, recebemos a assinatura.')
  })

  it('variável que o modelo pede e ficou vazia: recusa ANTES da Meta, com a frase', async () => {
    await expect(
      engineSendTemplate({ ...ARGS, params: [''], messageParams: { body: [''] } })
    ).rejects.toThrow(/send_template: a variável \{\{1\}\}/)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(h.mensagens).toEqual([])
  })

  it('cabeçalho de mídia sem arquivo no modelo nem no passo: recusa antes da Meta', async () => {
    h.linha = { ...LINHA, header_media_url: undefined }
    await expect(
      engineSendTemplate({ ...ARGS, params: ['Joana'], messageParams: { body: ['Joana'] } })
    ).rejects.toThrow(/imagem/)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('sem valores estruturados (chamador antigo): o caminho de sempre, só o corpo', async () => {
    await engineSendTemplate({ ...ARGS, params: ['Joana'] })
    const enviado = sendTemplateMessage.mock.calls[0]?.[0]
    expect(enviado?.template).toBeUndefined()
    expect(enviado?.params).toEqual(['Joana'])
  })
})
