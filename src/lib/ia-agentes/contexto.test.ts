import { describe, expect, it } from 'vitest'

import { montarConversa } from './contexto'

describe('montarConversa — o que o agente lê', () => {
  it('cliente é user; equipe, robô e o próprio agente são assistant', () => {
    expect(
      montarConversa([
        { sender_type: 'customer', content_type: 'text', content_text: 'Oi' },
        { sender_type: 'bot', content_type: 'text', content_text: '*Escritório:*\nOlá!' },
        { sender_type: 'agent', content_type: 'text', content_text: 'Pois não' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Oi' },
      // A assinatura SAI (o modelo não aprende a escrevê-la de novo).
      { role: 'assistant', content: 'Olá!' },
      { role: 'assistant', content: 'Pois não' },
    ])
  })

  it('áudio entra pela TRANSCRIÇÃO pronta; sem ela, diz que não foi transcrito', () => {
    expect(
      montarConversa([
        { sender_type: 'customer', content_type: 'audio', content_text: null, transcricao: 'quero a segunda via', transcricao_status: 'pronta' },
        { sender_type: 'customer', content_type: 'audio', content_text: null, transcricao: null, transcricao_status: 'falhou' },
      ]).map((m) => m.content),
    ).toEqual(['[audio message, transcribed] quero a segunda via', '[audio message, not transcribed]'])
  })

  it('documento com o nome e a legenda, sem repetir o nome que as linhas antigas guardam no texto', () => {
    expect(
      montarConversa([
        { sender_type: 'customer', content_type: 'document', content_text: 'segue', media_filename: 'extrato.pdf' },
        { sender_type: 'customer', content_type: 'document', content_text: 'extrato.pdf', media_filename: 'extrato.pdf' },
        { sender_type: 'customer', content_type: 'image', content_text: null },
      ]).map((m) => m.content),
    ).toEqual(['[document: extrato.pdf] segue', '[document: extrato.pdf]', '[image]'])
  })

  it('texto vazio não vira turno vazio', () => {
    expect(montarConversa([{ sender_type: 'customer', content_type: 'text', content_text: '   ' }])).toEqual([])
  })
})
