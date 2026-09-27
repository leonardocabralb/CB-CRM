import { describe, expect, it } from 'vitest'

import { montarConversa, MOTIVO_SEM_LEITOR, TETO_DA_LEITURA_NO_CONTEXTO } from './contexto'

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
    ).toEqual(['[document: extrato.pdf — not read yet] segue', '[document: extrato.pdf — not read yet]', '[image — not read yet]'])
  })

  it('vídeo entra como descrição, com a legenda — como a imagem (E9)', () => {
    expect(
      montarConversa([
        { sender_type: 'customer', content_type: 'video', content_text: 'olha o vazamento' },
        { sender_type: 'customer', content_type: 'video', content_text: null },
        { sender_type: 'customer', content_type: 'image', content_text: 'o boleto' },
      ]).map((m) => m.content),
    ).toEqual(['[video] olha o vazamento', '[video]', '[image — not read yet] o boleto'])
  })

  it('imagem e PDF entram com a LEITURA, na linha de baixo, depois da legenda', () => {
    expect(
      montarConversa([
        {
          sender_type: 'customer',
          content_type: 'image',
          content_text: 'olha o print',
          transcricao: 'Print de conversa. Banco: "sua dívida é R$ 3.000"',
          transcricao_status: 'pronta',
        },
        {
          sender_type: 'customer',
          content_type: 'document',
          content_text: 'segue',
          media_filename: 'extrato.pdf',
          transcricao: 'Extrato, saldo R$ 1.200,00',
          transcricao_status: 'pronta',
        },
        {
          sender_type: 'customer',
          content_type: 'document',
          content_text: null,
          media_filename: 'contrato.pdf',
          transcricao: 'Contrato de honorários',
          transcricao_status: 'pronta',
        },
      ]).map((m) => m.content),
    ).toEqual([
      '[image] olha o print\n(content: Print de conversa. Banco: "sua dívida é R$ 3.000")',
      '[document: extrato.pdf] segue\n(content: Extrato, saldo R$ 1.200,00)',
      '[document: contrato.pdf]\n(content: Contrato de honorários)',
    ])
  })

  it('a RECUSA gravada vai junto — o agente sabe que não viu; sem leitura (falhou, lendo), "not read yet"', () => {
    expect(
      montarConversa([
        {
          sender_type: 'customer',
          content_type: 'document',
          content_text: null,
          media_filename: 'procuracao.docx',
          transcricao_status: 'recusada',
          transcricao_erro: 'tipo de arquivo que o agente não lê',
        },
        { sender_type: 'customer', content_type: 'image', content_text: 'foto', transcricao_status: 'recusada', transcricao_erro: null },
        { sender_type: 'customer', content_type: 'image', content_text: null, transcricao_status: 'falhou', transcricao_erro: 'HTTP 500' },
        // Leitura pela metade (`transcrevendo`) não entra.
        { sender_type: 'customer', content_type: 'image', content_text: null, transcricao: 'meio', transcricao_status: 'transcrevendo' },
      ]).map((m) => m.content),
    ).toEqual([
      '[document: procuracao.docx — could not be read: tipo de arquivo que o agente não lê]',
      '[image — could not be read: unknown reason] foto',
      '[image — not read yet]',
      '[image — not read yet]',
    ])
  })

  it('⚠️ a FIGURINHA é [sticker] — nunca uma foto "não lida" (seria pergunta ao cliente sobre um emoji)', () => {
    expect(
      montarConversa([
        { sender_type: 'customer', content_type: 'image', content_text: null, media_type: 'image/webp' },
        { sender_type: 'customer', content_type: 'image', content_text: null, media_type: 'IMAGE/WEBP; charset=binary' },
        { sender_type: 'customer', content_type: 'sticker', content_text: null },
        // A foto de verdade continua foto.
        { sender_type: 'customer', content_type: 'image', content_text: null, media_type: 'image/jpeg' },
      ]).map((m) => m.content),
    ).toEqual(['[sticker]', '[sticker]', '[sticker]', '[image — not read yet]'])
  })

  it('SEM LEITOR nesta rodada (nenhuma chave lê o arquivo): "could not be read" com o motivo GENÉRICO — nunca o da equipe', () => {
    const [m] = montarConversa(
      [{ id: 'heic-1', sender_type: 'customer', content_type: 'image', content_text: 'olha', media_type: 'image/heic' }],
      new Set(['heic-1']),
    )
    expect(m.content).toBe(`[image — could not be read: ${MOTIVO_SEM_LEITOR}] olha`)
    expect(m.content).not.toMatch(/Integrações|chave/)
  })

  it('a mídia da EQUIPE fica só com o rótulo: ninguém a lê, e "not read yet" nela faria o agente dizer que ainda está olhando', () => {
    expect(
      montarConversa([
        { sender_type: 'agent', content_type: 'image', content_text: 'segue o boleto' },
        { sender_type: 'bot', content_type: 'document', content_text: null, media_filename: 'contrato.pdf' },
      ]).map((m) => m.content),
    ).toEqual(['[image] segue o boleto', '[document: contrato.pdf]'])
  })

  it('a leitura longa entra CORTADA no pedido, com o corte declarado', () => {
    const [m] = montarConversa([
      {
        sender_type: 'customer',
        content_type: 'document',
        content_text: null,
        media_filename: 'longo.pdf',
        transcricao: 'x'.repeat(TETO_DA_LEITURA_NO_CONTEXTO * 3),
        transcricao_status: 'pronta',
      },
    ])
    expect(m.content.length).toBeLessThan(TETO_DA_LEITURA_NO_CONTEXTO + 60)
    expect(m.content.endsWith(' […cut])')).toBe(true)
  })

  it('texto vazio não vira turno vazio', () => {
    expect(montarConversa([{ sender_type: 'customer', content_type: 'text', content_text: '   ' }])).toEqual([])
  })
})
