import { describe, expect, it } from 'vitest'

import { OFFLINE_AFTER_MS } from '@/lib/presence'
import {
  quemVeAConversa,
  type ConversaAbertaRow,
} from './presenca-na-conversa'

const AGORA = Date.UTC(2026, 7, 30, 12, 0, 0)
const CONVERSA = 'conv-1'

function linha(
  userId: string,
  conversationId: string | null,
  msAtras = 0,
): ConversaAbertaRow {
  return {
    user_id: userId,
    conversation_id: conversationId,
    visto_em: new Date(AGORA - msAtras).toISOString(),
  }
}

describe('quemVeAConversa', () => {
  it('inclui quem está na MESMA conversa com batida fresca', () => {
    expect(quemVeAConversa([linha('ana', CONVERSA)], CONVERSA, 'eu', AGORA)).toEqual([
      'ana',
    ])
  })

  it('eu fico de fora', () => {
    expect(quemVeAConversa([linha('eu', CONVERSA)], CONVERSA, 'eu', AGORA)).toEqual([])
  })

  it('outra conversa e fora-de-conversa (null) não casam', () => {
    const rows = [linha('ana', 'conv-2'), linha('bia', null)]
    expect(quemVeAConversa(rows, CONVERSA, 'eu', AGORA)).toEqual([])
  })

  it('batida velha = saiu (aba fechada não escreve nada)', () => {
    const rows = [linha('ana', CONVERSA, OFFLINE_AFTER_MS + 1)]
    expect(quemVeAConversa(rows, CONVERSA, 'eu', AGORA)).toEqual([])
  })

  it('no limiar exato ainda conta como presente', () => {
    const rows = [linha('ana', CONVERSA, OFFLINE_AFTER_MS)]
    expect(quemVeAConversa(rows, CONVERSA, 'eu', AGORA)).toEqual(['ana'])
  })

  it('visto_em ilegível fica de fora sem estourar', () => {
    const rows: ConversaAbertaRow[] = [
      { user_id: 'ana', conversation_id: CONVERSA, visto_em: 'lixo' },
    ]
    expect(quemVeAConversa(rows, CONVERSA, 'eu', AGORA)).toEqual([])
  })

  it('sem conversa selecionada devolve vazio', () => {
    expect(quemVeAConversa([linha('ana', CONVERSA)], null, 'eu', AGORA)).toEqual([])
  })

  it('ordem estável por user_id, independente da ordem das linhas', () => {
    const rows = [linha('carla', CONVERSA), linha('ana', CONVERSA), linha('bia', CONVERSA)]
    expect(quemVeAConversa(rows, CONVERSA, 'eu', AGORA)).toEqual([
      'ana',
      'bia',
      'carla',
    ])
  })
})
