import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
} from './meta-api'

// ============================================================
// Fase 11.3 — os três remetentes que o `meta-api.recipient.test.ts` do
// original não cobre: reação, botões e lista. A Meta endereça pelo telefone
// (`to` + `recipient_type`) OU pelo BSUID (`recipient`), nunca os dois; a
// ficha só-BSUID responde por estes três também (a reação pela rota
// `/api/whatsapp/react`; botões e lista pelo robô). Arquivo NOSSO ao lado do
// do original, para um merge não precisar costurá-los.
// ============================================================

let captured: Record<string, unknown> | null = null

beforeEach(() => {
  captured = null
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.OK' }] }), {
        status: 200,
      })
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE = { phoneNumberId: 'pn-1', accessToken: 'tok' } as const
const BSUID = 'BR.13491208655302741918'

const ENVIOS = [
  {
    nome: 'reação',
    enviar: (to: string) =>
      sendReactionMessage({ ...BASE, to, targetMessageId: 'wamid.ALVO', emoji: '👍' }),
    tipo: 'reaction',
  },
  {
    nome: 'botões',
    enviar: (to: string) =>
      sendInteractiveButtons({
        ...BASE,
        to,
        bodyText: 'Escolha',
        buttons: [{ id: 'a', title: 'A' }],
      }),
    tipo: 'interactive',
  },
  {
    nome: 'lista',
    enviar: (to: string) =>
      sendInteractiveList({
        ...BASE,
        to,
        bodyText: 'Escolha',
        buttonLabel: 'Ver',
        sections: [{ rows: [{ id: 'x', title: 'X' }] }],
      }),
    tipo: 'interactive',
  },
]

describe('reação, botões e lista: BSUID vai em `recipient`, telefone em `to`', () => {
  for (const e of ENVIOS) {
    it(`${e.nome}: BSUID sai em recipient, sem to nem recipient_type`, async () => {
      await e.enviar(BSUID)
      expect(captured).toMatchObject({ recipient: BSUID, type: e.tipo })
      expect(captured).not.toHaveProperty('to')
      expect(captured).not.toHaveProperty('recipient_type')
    })

    it(`${e.nome}: telefone continua em to + recipient_type`, async () => {
      await e.enviar('5583988887777')
      expect(captured).toMatchObject({
        to: '5583988887777',
        recipient_type: 'individual',
        type: e.tipo,
      })
      expect(captured).not.toHaveProperty('recipient')
    })
  }
})
