import { describe, expect, it } from 'vitest'

import {
  montarConversa,
  MOTIVO_SEM_LEITOR,
  NOTA_DA_RESPOSTA_CRUZADA,
  ROTULO_DA_EQUIPE,
  semRotuloDaEquipe,
  terminarNoCliente,
  TETO_DA_LEITURA_NO_CONTEXTO,
  type MensagemDoContexto,
} from './contexto'

describe('terminarNoCliente — a conversa ao modelo nunca termina na empresa (revisão de 09/11/2026)', () => {
  it('termina na empresa (a mensagem do cliente cruzou com a resposta): ganha a nota no papel de usuário', () => {
    const conversa = [
      { role: 'user' as const, content: 'Quanto custa?' },
      { role: 'assistant' as const, content: 'Qual o valor da dívida?' },
    ]
    expect(terminarNoCliente(conversa)).toEqual([...conversa, { role: 'user', content: NOTA_DA_RESPOSTA_CRUZADA }])
    // Não muda o original (a busca da base e as travas leem a conversa crua).
    expect(conversa).toHaveLength(2)
  })

  it('termina no cliente: igual; sem fala do cliente nenhuma: igual (o adaptador cuida)', () => {
    const doCliente = [{ role: 'user' as const, content: 'Oi' }]
    expect(terminarNoCliente(doCliente)).toEqual(doCliente)
    const soDaEmpresa = [{ role: 'assistant' as const, content: 'Olá!' }]
    expect(terminarNoCliente(soDaEmpresa)).toEqual(soDaEmpresa)
    expect(terminarNoCliente([])).toEqual([])
  })

  it('a nota diz que NÃO é o cliente', () => {
    expect(NOTA_DA_RESPOSTA_CRUZADA).toMatch(/^\[System note, not a message from the customer:/)
  })
})

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

describe('montarConversa — a fala da EQUIPE vai rotulada (1138, decisão do operador de 11/11/2026)', () => {
  const linha = (p: Partial<MensagemDoContexto>): MensagemDoContexto => ({
    sender_type: 'agent',
    content_type: 'text',
    content_text: 'Me manda o holerite.',
    ...p,
  })

  it('a equipe pelo CRM (`sender_id`) e pelo celular (`from_device`): rótulo, SEM o nome da pessoa', () => {
    const [crm, celular] = montarConversa([linha({ sender_id: 'membro-1' }), linha({ from_device: true })])
    expect(crm).toEqual({ role: 'assistant', content: `${ROTULO_DA_EQUIPE} Me manda o holerite.` })
    expect(celular.content).toBe(`${ROTULO_DA_EQUIPE} Me manda o holerite.`)
  })

  it('a IA, o robô, a automação e a mensagem sem autor (API) ficam sem rótulo', () => {
    const conversa = montarConversa([
      linha({ sender_type: 'bot', ia_agente_id: 'ag-1' }),
      linha({ sender_type: 'bot' }),
      linha({ sender_id: null, from_device: false }),
      linha({ sender_type: 'agent', sender_id: 'membro-1', ia_agente_id: 'ag-1' }),
    ])
    expect(conversa.every((m) => !m.content.startsWith(ROTULO_DA_EQUIPE))).toBe(true)
  })

  it('a fala da cliente nunca leva rótulo', () => {
    expect(montarConversa([linha({ sender_type: 'customer', from_device: true })])[0]).toEqual({
      role: 'user',
      content: 'Me manda o holerite.',
    })
  })

  it('vazia continua fora (o rótulo sozinho não é fala)', () => {
    expect(montarConversa([linha({ sender_id: 'membro-1', content_text: '  ' })])).toEqual([])
  })
})

describe('semRotuloDaEquipe — o rótulo que o modelo imitou nunca chega ao cliente', () => {
  it.each([
    ['[Team member] Oi, tudo bem?', 'Oi, tudo bem?'],
    ['[team member]: Oi', 'Oi'],
    ['  [ Team Member ] — Oi', 'Oi'],
    ['Oi!\n[Team member] Segue o link.', 'Oi!\nSegue o link.'],
  ])('%j → %j', (de, para) => {
    expect(semRotuloDaEquipe(de)).toBe(para)
  })

  it.each([
    ['O [Team member] disse que sim', 'O disse que sim'],
    ['**[Team member]** Oi', 'Oi'],
    ['_[Team member]_: Oi', 'Oi'],
    ['[Membro da equipe] Oi', 'Oi'],
    ['Oi, tudo bem? Sem rótulo nenhum.', 'Oi, tudo bem? Sem rótulo nenhum.'],
  ])('em qualquer forma: %j → %j', (de, para) => {
    expect(semRotuloDaEquipe(de)).toBe(para)
  })
})
