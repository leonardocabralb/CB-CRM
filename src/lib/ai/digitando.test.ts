import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  enviar: vi.fn(),
}))

vi.mock('@/lib/cb-channels/engine-send', () => ({ resolveEngineChannelPreferring: h.resolve }))
vi.mock('@/lib/whatsapp/meta-api', () => ({ sendTypingIndicator: h.enviar }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (x: string) => `claro:${x}` }))

import { mostrarDigitando } from './digitando'

const db = {} as SupabaseClient
const TOKEN = 'EAAtokenMuitoLongoDeVerdade123'
const META = {
  provider: 'meta',
  phone_number_id: 'pn-1',
  access_token: 'cifrado',
  channelId: 'canal-meta',
}
const ARGS = {
  accountId: 'a1',
  conversationId: 'c1',
  channelId: 'canal-meta',
  inboundMessageId: 'wamid.HBgM123',
}

beforeEach(() => {
  h.resolve.mockReset().mockResolvedValue(META)
  h.enviar.mockReset().mockResolvedValue(undefined)
})

describe('mostrarDigitando', () => {
  it('canal Meta + wamid: marca como lida e mostra "digitando…" PELO MESMO canal da resposta', async () => {
    expect(await mostrarDigitando(db, ARGS)).toBe('enviado')
    // A mesma resolução de engineSendText: o canal por onde o cliente escreveu.
    expect(h.resolve).toHaveBeenCalledWith(db, 'a1', 'c1', 'canal-meta')
    expect(h.enviar).toHaveBeenCalledWith({
      phoneNumberId: 'pn-1',
      accessToken: 'claro:cifrado',
      messageId: 'wamid.HBgM123',
    })
  })

  it('sem id, ou id que não é da Meta (Evolution): não chama nada', async () => {
    expect(await mostrarDigitando(db, { ...ARGS, inboundMessageId: null })).toBe('pulado')
    expect(await mostrarDigitando(db, { ...ARGS, inboundMessageId: '3EB0ABC123' })).toBe('pulado')
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.enviar).not.toHaveBeenCalled()
  })

  it('canal que resolve para Evolution, Instagram ou nada: não chama a Meta', async () => {
    for (const canal of [
      { ...META, provider: 'evolution' },
      { ...META, provider: 'instagram' },
      null,
      { ...META, access_token: null },
    ]) {
      h.resolve.mockResolvedValueOnce(canal)
      expect(await mostrarDigitando(db, ARGS)).toBe('pulado')
    }
    expect(h.enviar).not.toHaveBeenCalled()
  })

  it('falha da Meta: devolve "falhou", NUNCA lança, e o log não leva o token', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.resolve.mockResolvedValueOnce({ ...META, access_token: TOKEN })
    h.enviar.mockRejectedValueOnce(new Error(`Malformed access token claro:${TOKEN}`))
    await expect(mostrarDigitando(db, ARGS)).resolves.toBe('falhou')
    const logado = aviso.mock.calls.flat().join(' ')
    expect(logado).not.toContain(TOKEN)
    aviso.mockRestore()
  })

  it('erro ao resolver o canal também não lança', async () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.resolve.mockRejectedValueOnce(new Error('db fora'))
    await expect(mostrarDigitando(db, ARGS)).resolves.toBe('falhou')
    aviso.mockRestore()
  })
})
