import { describe, expect, it } from 'vitest'

import {
  erroDoProvedor,
  extensao,
  extensaoDoAudio,
  falhaPassageira,
  INSTRUCAO_DA_IMAGEM,
  INSTRUCAO_DO_DOCUMENTO,
  LIMITE_DE_BYTES,
  LIMITE_INLINE_DO_GEMINI,
  MARCA_ILEGIVEL,
  MAX_TOKENS_DA_LEITURA,
  lerRespostaDeLeitura,
  lerRespostaDeTranscricaoOpenAi,
  MARCA_DE_CORTE,
  mimeLimpo,
  MODELO_DE_LEITURA,
  MODELO_TRANSCRICAO_OPENAI,
  nomeParaOProvedor,
  ORDEM_DA_LEITURA,
  ORDEM_DA_TRANSCRICAO,
  pedidoDeLeitura,
  pedidoDeTranscricaoOpenAi,
  provedorLe,
  TEMPO_DA_LEITURA_MS,
  TETO_DO_TEXTO,
  textoParaGravar,
  tipoDoMime,
} from './leitores'

// ============================================================
// Os adaptadores, cada um na forma DOCUMENTADA do provedor (conferida em
// 27/09/2026 — as URLs estão em `leitores.ts`). Os literais são escritos à
// mão de propósito: comparar o código com a própria constante passaria com
// ela errada (a lição de `MODELO_TRANSCRICAO`).
// ============================================================

const B64 = 'QUJD' // "ABC"

function corpo(p: { body: string | FormData }): Record<string, unknown> {
  return JSON.parse(p.body as string) as Record<string, unknown>
}

describe('a ordem e os modelos fixos', () => {
  it('imagem e documento: Gemini → OpenAI → Anthropic; áudio: Gemini → OpenAI (a Anthropic não ouve)', () => {
    expect(ORDEM_DA_LEITURA).toEqual(['gemini', 'openai', 'anthropic'])
    expect(ORDEM_DA_TRANSCRICAO).toEqual(['gemini', 'openai'])
  })

  it('os modelos, escritos à mão', () => {
    expect(MODELO_DE_LEITURA).toEqual({
      gemini: 'gemini-3.8-flash',
      openai: 'gpt-5.4-mini',
      anthropic: 'claude-haiku-5-5',
    })
    expect(MODELO_TRANSCRICAO_OPENAI).toBe('gpt-transcribe')
  })
})

describe('pedidoDeLeitura — Gemini', () => {
  it('imagem em `inlineData`, chave no cabeçalho, nunca na URL', () => {
    const p = pedidoDeLeitura({ provedor: 'gemini', chave: 'g-1', tipo: 'imagem', mime: 'image/jpeg', arquivo: { base64: B64 }, nomeDoArquivo: 'x' })
    expect(p.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(p.url).not.toContain('key=')
    expect(p.headers['x-goog-api-key']).toBe('g-1')
    const partes = (corpo(p).contents as { parts: Record<string, unknown>[] }[])[0].parts
    expect(partes[1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: B64 } })
    expect(String(partes[0].text)).toMatch(/transcribe ALL visible text verbatim/)
  })

  it('PDF também em `inlineData`, com o pedido de extrair o texto', () => {
    const p = pedidoDeLeitura({ provedor: 'gemini', chave: 'g-1', tipo: 'documento', mime: 'application/pdf', arquivo: { base64: B64 }, nomeDoArquivo: 'a.pdf' })
    const partes = (corpo(p).contents as { parts: Record<string, unknown>[] }[])[0].parts
    expect(partes[1]).toEqual({ inlineData: { mimeType: 'application/pdf', data: B64 } })
    expect(String(partes[0].text)).toMatch(/extract the text content of this document faithfully/)
  })
})

describe('pedidoDeLeitura — Gemini: Office e arquivo grande', () => {
  it('Word e Excel vão em `inlineData` com o mime do arquivo, com o pedido do documento', () => {
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const p = pedidoDeLeitura({ provedor: 'gemini', chave: 'g-1', tipo: 'documento', mime: xlsx, arquivo: { base64: B64 }, nomeDoArquivo: 'LEVANTAMENTO.xlsx' })
    const partes = (corpo(p).contents as { parts: Record<string, unknown>[] }[])[0].parts
    expect(partes[1]).toEqual({ inlineData: { mimeType: xlsx, data: B64 } })
    expect(String(partes[0].text)).toMatch(/extract the text content of this document faithfully/)
  })

  it('o arquivo já enviado pela Files API vai como `file_data` (a forma do REST da doc), sem base64', () => {
    const uri = 'https://generativelanguage.googleapis.com/v1beta/files/abc123'
    const p = pedidoDeLeitura({ provedor: 'gemini', chave: 'g-1', tipo: 'documento', mime: 'application/pdf', arquivo: { uriDoGemini: uri }, nomeDoArquivo: 'a.pdf' })
    const partes = (corpo(p).contents as { parts: Record<string, unknown>[] }[])[0].parts
    expect(partes[1]).toEqual({ file_data: { mime_type: 'application/pdf', file_uri: uri } })
    expect(p.body).not.toContain('inlineData')
  })

  it('⚠️ só o Gemini recebe o arquivo da Files API: OpenAI e Anthropic lançam', () => {
    for (const provedor of ['openai', 'anthropic'] as const) {
      expect(() =>
        pedidoDeLeitura({ provedor, chave: 'k', tipo: 'documento', mime: 'application/pdf', arquivo: { uriDoGemini: 'u' }, nomeDoArquivo: 'a.pdf' }),
      ).toThrow(/só o Gemini/)
    }
  })

  it('o teto de saída é o mesmo nos três provedores, escrito à mão: 24.576 (o raciocínio conta dentro)', () => {
    expect(MAX_TOKENS_DA_LEITURA).toBe(24_576)
    const g = corpo(pedidoDeLeitura({ provedor: 'gemini', chave: 'k', tipo: 'imagem', mime: 'image/png', arquivo: { base64: B64 }, nomeDoArquivo: 'x' }))
    expect((g.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(24_576)
    const o = corpo(pedidoDeLeitura({ provedor: 'openai', chave: 'k', tipo: 'imagem', mime: 'image/png', arquivo: { base64: B64 }, nomeDoArquivo: 'x' }))
    expect(o.max_output_tokens).toBe(24_576)
    const a = corpo(pedidoDeLeitura({ provedor: 'anthropic', chave: 'k', tipo: 'imagem', mime: 'image/png', arquivo: { base64: B64 }, nomeDoArquivo: 'x' }))
    expect(a.max_tokens).toBe(24_576)
  })
})

describe('pedidoDeLeitura — OpenAI (Responses)', () => {
  it('imagem como `input_image` com data URL, Bearer, e SEM guardar a resposta', () => {
    const p = pedidoDeLeitura({ provedor: 'openai', chave: 'sk-1', tipo: 'imagem', mime: 'image/png', arquivo: { base64: B64 }, nomeDoArquivo: 'x' })
    expect(p.url).toBe('https://api.openai.com/v1/responses')
    expect(p.headers.Authorization).toBe('Bearer sk-1')
    const c = corpo(p)
    expect(c.model).toBe('gpt-5.4-mini')
    // Documento de cliente: por padrão a Responses guarda a resposta.
    expect(c.store).toBe(false)
    const conteudo = (c.input as { content: Record<string, unknown>[] }[])[0].content
    expect(conteudo[0]).toEqual({ type: 'input_image', image_url: `data:image/png;base64,${B64}` })
    expect(conteudo[1].type).toBe('input_text')
  })

  it('PDF como `input_file` com `filename` e `file_data` em data URL', () => {
    const p = pedidoDeLeitura({ provedor: 'openai', chave: 'sk-1', tipo: 'documento', mime: 'application/pdf', arquivo: { base64: B64 }, nomeDoArquivo: 'extrato.pdf' })
    const conteudo = (corpo(p).input as { content: Record<string, unknown>[] }[])[0].content
    expect(conteudo[0]).toEqual({
      type: 'input_file',
      filename: 'extrato.pdf',
      file_data: `data:application/pdf;base64,${B64}`,
    })
  })
})

describe('pedidoDeLeitura — Anthropic', () => {
  it('imagem num bloco `image` base64, ANTES do texto; x-api-key e versão', () => {
    const p = pedidoDeLeitura({ provedor: 'anthropic', chave: 'a-1', tipo: 'imagem', mime: 'image/webp', arquivo: { base64: B64 }, nomeDoArquivo: 'x' })
    expect(p.url).toBe('https://api.anthropic.com/v1/messages')
    expect(p.headers['x-api-key']).toBe('a-1')
    expect(p.headers['anthropic-version']).toBe('2023-06-01')
    const c = corpo(p)
    expect(c.model).toBe('claude-haiku-5-5')
    const conteudo = (c.messages as { content: Record<string, unknown>[] }[])[0].content
    expect(conteudo[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/webp', data: B64 } })
    expect(conteudo[1].type).toBe('text')
  })

  it('PDF num bloco `document` base64', () => {
    const p = pedidoDeLeitura({ provedor: 'anthropic', chave: 'a-1', tipo: 'documento', mime: 'application/pdf', arquivo: { base64: B64 }, nomeDoArquivo: 'x.pdf' })
    const conteudo = (corpo(p).messages as { content: Record<string, unknown>[] }[])[0].content
    expect(conteudo[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: B64 } })
  })
})

describe('lerRespostaDeLeitura', () => {
  it('Gemini: junta as partes; MAX_TOKENS = cortado; uso', () => {
    const r = lerRespostaDeLeitura('gemini', {
      candidates: [{ content: { parts: [{ text: 'Boleto ' }, { text: 'R$ 150' }] }, finishReason: 'MAX_TOKENS' }],
      usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 20, totalTokenCount: 320 },
    })
    expect(r).toEqual({
      texto: 'Boleto R$ 150',
      cortado: true,
      bloqueio: null,
      usage: { promptTokens: 300, completionTokens: 20, totalTokens: 320 },
    })
  })

  it('OpenAI: só os itens `message` (o raciocínio vem junto no `output`), incompleto por teto = cortado', () => {
    const r = lerRespostaDeLeitura('openai', {
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'Print de conversa:' }, { type: 'output_text', text: ' "oi"' }] },
      ],
      usage: { input_tokens: 800, output_tokens: 40, total_tokens: 840 },
    })
    expect(r).toEqual({
      texto: 'Print de conversa: "oi"',
      cortado: true,
      bloqueio: null,
      usage: { promptTokens: 800, completionTokens: 40, totalTokens: 840 },
    })
  })

  it('Anthropic: blocos de texto; `max_tokens` = cortado; total somado', () => {
    const r = lerRespostaDeLeitura('anthropic', {
      content: [{ type: 'text', text: 'Contrato de honorários' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1500, output_tokens: 10 },
    })
    expect(r).toEqual({
      texto: 'Contrato de honorários',
      cortado: false,
      bloqueio: null,
      usage: { promptTokens: 1500, completionTokens: 10, totalTokens: 1510 },
    })
    expect(
      lerRespostaDeLeitura('anthropic', { content: [{ type: 'text', text: 'metade' }], stop_reason: 'max_tokens' }),
    ).toMatchObject({ cortado: true, bloqueio: null })
    expect(
      lerRespostaDeLeitura('anthropic', { content: [{ type: 'text', text: 'x' }], stop_reason: 'model_context_window_exceeded' }),
    ).toMatchObject({ cortado: true, bloqueio: null })
  })

  // ⚠️ Os bloqueios (os fins que NÃO entregam a leitura), com os nomes
  // conferidos na documentação em 27/09/2026. O texto que vem junto — um
  // pedaço recitado, a frase de recusa — é devolvido, mas `ler-midia.ts` não o
  // grava: o bloqueio decide.
  it('Gemini: RECITATION, SAFETY e o pedido bloqueado NÃO entregam; sem `finishReason` não se acusa', () => {
    const recitacao = lerRespostaDeLeitura('gemini', {
      candidates: [{ content: { parts: [{ text: 'trecho recitado' }] }, finishReason: 'RECITATION' }],
    })
    expect(recitacao).toMatchObject({ texto: 'trecho recitado', cortado: false, bloqueio: 'leitura interrompida (RECITATION)' })
    expect(lerRespostaDeLeitura('gemini', { candidates: [{ finishReason: 'SAFETY' }] }).bloqueio).toBe('leitura interrompida (SAFETY)')
    expect(lerRespostaDeLeitura('gemini', { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }).bloqueio).toBe(
      'pedido bloqueado (PROHIBITED_CONTENT)',
    )
    expect(lerRespostaDeLeitura('gemini', { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }).bloqueio).toBeNull()
  })

  it('OpenAI: a recusa (parte `refusal`), o `content_filter` e o status que não é `completed` NÃO entregam', () => {
    const recusa = lerRespostaDeLeitura('openai', {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: "I can't help with that." }] }],
    })
    expect(recusa).toMatchObject({ texto: '', bloqueio: 'o modelo se recusou a ler' })
    expect(
      lerRespostaDeLeitura('openai', {
        status: 'incomplete',
        incomplete_details: { reason: 'content_filter' },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'meio' }] }],
      }),
    ).toMatchObject({ texto: 'meio', cortado: false, bloqueio: 'leitura incompleta (content_filter)' })
    expect(lerRespostaDeLeitura('openai', { status: 'failed', output: [] }).bloqueio).toBe('leitura não concluída (failed)')
    expect(
      lerRespostaDeLeitura('openai', {
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
      }).bloqueio,
    ).toBeNull()
  })

  it('Anthropic: `refusal` (200 com a recusa) e os fins de ferramenta NÃO entregam', () => {
    expect(
      lerRespostaDeLeitura('anthropic', { content: [{ type: 'text', text: 'Não posso ajudar.' }], stop_reason: 'refusal' }),
    ).toMatchObject({ texto: 'Não posso ajudar.', bloqueio: 'o modelo se recusou a ler' })
    expect(lerRespostaDeLeitura('anthropic', { content: [], stop_reason: 'pause_turn' }).bloqueio).toBe(
      'leitura interrompida (pause_turn)',
    )
    expect(lerRespostaDeLeitura('anthropic', { content: [{ type: 'text', text: 'x' }], stop_reason: 'stop_sequence' }).bloqueio).toBeNull()
  })

  it('corpo estranho não lança: texto vazio', () => {
    expect(lerRespostaDeLeitura('openai', null).texto).toBe('')
    expect(lerRespostaDeLeitura('anthropic', { content: 'x' }).texto).toBe('')
    expect(lerRespostaDeLeitura('gemini', {}).texto).toBe('')
  })
})

describe('tipos e tamanhos', () => {
  it('mime limpo: parâmetros, caixa, `image/jpg` e octet-stream', () => {
    expect(mimeLimpo('IMAGE/JPEG; charset=binary')).toBe('image/jpeg')
    expect(mimeLimpo('image/jpg')).toBe('image/jpeg')
    expect(mimeLimpo('application/octet-stream')).toBeNull()
    expect(mimeLimpo(null)).toBeNull()
  })

  it('extensão do nome e da URL', () => {
    expect(extensao('Extrato Junho.PDF')).toBe('pdf')
    expect(extensao('https://x/chat-media/account-1/123-foto.jpg?v=2')).toBe('jpg')
    expect(extensao('README')).toBeNull()
    expect(extensao('.oculto')).toBeNull()
  })

  it('o que ALGUM provedor lê — e o que cada um lê', () => {
    expect(tipoDoMime('application/pdf')).toBe('documento')
    expect(tipoDoMime('image/heic')).toBe('imagem')
    expect(tipoDoMime('image/gif')).toBe('imagem')
    expect(tipoDoMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('documento')
    expect(tipoDoMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('documento')
    expect(tipoDoMime('application/vnd.ms-excel')).toBe('documento')
    expect(tipoDoMime('image/bmp')).toBeNull()
    expect(tipoDoMime('application/zip')).toBeNull()
    expect(tipoDoMime('text/plain')).toBeNull()
    // HEIC só o Gemini; GIF todos menos o Gemini.
    expect(provedorLe('gemini', 'imagem', 'image/heic')).toBe(true)
    expect(provedorLe('openai', 'imagem', 'image/heic')).toBe(false)
    expect(provedorLe('anthropic', 'imagem', 'image/heic')).toBe(false)
    expect(provedorLe('gemini', 'imagem', 'image/gif')).toBe(false)
    expect(provedorLe('anthropic', 'imagem', 'image/gif')).toBe(true)
    for (const p of ORDEM_DA_LEITURA) expect(provedorLe(p, 'documento', 'application/pdf')).toBe(true)
    // Word, Excel e PowerPoint: só o Gemini (os outros dois só leem PDF).
    for (const mime of [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]) {
      expect(provedorLe('gemini', 'documento', mime)).toBe(true)
      expect(provedorLe('openai', 'documento', mime)).toBe(false)
      expect(provedorLe('anthropic', 'documento', mime)).toBe(false)
    }
  })

  it('os limites (bytes do ARQUIVO): Gemini 14 MB na imagem e 50 MB no documento (Files API), Anthropic 7 MB, e o nosso teto de 20 MB', () => {
    const MB = 1024 * 1024
    expect(LIMITE_DE_BYTES).toEqual({
      gemini: { imagem: 14 * MB, documento: 50 * MB },
      openai: { imagem: 20 * MB, documento: 20 * MB },
      anthropic: { imagem: 7 * MB, documento: 20 * MB },
    })
    // Acima de 14 MB o documento vai ao Gemini pela Files API: o base64 do que vai DENTRO cabe nos 20 MB.
    expect(LIMITE_INLINE_DO_GEMINI).toBe(14 * MB)
    expect((LIMITE_INLINE_DO_GEMINI * 4) / 3).toBeLessThan(20 * MB)
    // O base64 da imagem do Gemini cabe no pedido de 20 MB; o da Anthropic, nos 10 MB por imagem.
    expect((LIMITE_DE_BYTES.gemini.imagem * 4) / 3).toBeLessThan(20 * MB)
    expect((LIMITE_DE_BYTES.anthropic.imagem * 4) / 3).toBeLessThan(10 * MB)
    // E o PDF em base64 cabe nos 32 MB do pedido da Anthropic.
    expect((LIMITE_DE_BYTES.anthropic.documento * 4) / 3).toBeLessThan(32 * MB)
  })
})

describe('textoParaGravar', () => {
  it('declara o corte do provedor', () => {
    expect(textoParaGravar(' metade ', true)).toBe(`metade\n${MARCA_DE_CORTE}`)
    expect(textoParaGravar(' inteiro ', false)).toBe('inteiro')
  })

  it('nunca passa do teto, e o corte é declarado', () => {
    const longo = 'x'.repeat(TETO_DO_TEXTO * 2)
    const t = textoParaGravar(longo, false)
    expect(t.length).toBeLessThanOrEqual(TETO_DO_TEXTO)
    expect(t.endsWith(MARCA_DE_CORTE)).toBe(true)
  })
})

describe('transcrição pela OpenAI', () => {
  it('multipart para /v1/audio/transcriptions, com o modelo, o português e o arquivo com a extensão do formato', async () => {
    const p = pedidoDeTranscricaoOpenAi({ chave: 'sk-1', bytes: new Uint8Array([1, 2, 3]), mime: 'audio/ogg; codecs=opus' })
    expect(p.url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(p.headers).toEqual({ Authorization: 'Bearer sk-1' })
    const form = p.body as FormData
    expect(form.get('model')).toBe('gpt-transcribe')
    expect(form.getAll('languages[]')).toEqual(['pt'])
    const arquivo = form.get('file') as File
    expect(arquivo.name).toBe('audio.ogg')
    expect(arquivo.size).toBe(3)
  })

  it('a extensão decide o formato para a OpenAI', () => {
    expect(extensaoDoAudio('audio/mpeg')).toBe('mp3')
    expect(extensaoDoAudio('audio/mp4')).toBe('m4a')
    expect(extensaoDoAudio('audio/wav')).toBe('wav')
    expect(extensaoDoAudio(null)).toBe('ogg')
  })

  it('a resposta: texto e uso por tokens (por duração não tem token)', () => {
    expect(
      lerRespostaDeTranscricaoOpenAi({
        text: ' Oi doutor ',
        usage: { type: 'tokens', input_tokens: 50, output_tokens: 5, total_tokens: 55 },
      }),
    ).toEqual({ texto: 'Oi doutor', usage: { promptTokens: 50, completionTokens: 5, totalTokens: 55 } })
    expect(lerRespostaDeTranscricaoOpenAi({ text: 'x', usage: { type: 'duration', seconds: 3 } }).usage).toBeNull()
  })

  it('⚠️ texto VAZIO (o áudio sem fala) é diferente de texto AUSENTE (resposta malformada)', () => {
    expect(lerRespostaDeTranscricaoOpenAi({ text: '  ' }).texto).toBe('')
    expect(lerRespostaDeTranscricaoOpenAi({}).texto).toBeNull()
    expect(lerRespostaDeTranscricaoOpenAi(null).texto).toBeNull()
  })
})

describe('o prazo e o tamanho da resposta da leitura', () => {
  it('prazo PRÓPRIO, escrito à mão: 45 s na imagem, 90 s no documento (não os 30 s do chat)', () => {
    expect(TEMPO_DA_LEITURA_MS).toEqual({ imagem: 45_000, documento: 90_000 })
  })

  it('as instruções pedem no máximo ~6.000 caracteres, resumindo o que passar', () => {
    expect(INSTRUCAO_DA_IMAGEM).toContain('under 6,000 characters')
    expect(INSTRUCAO_DO_DOCUMENTO).toContain('would exceed 6,000 characters, summarize it')
    expect(INSTRUCAO_DO_DOCUMENTO).not.toContain('10,000')
  })

  it('⚠️ o borrado vira [ilegível], nunca palpite — nas duas instruções', () => {
    expect(MARCA_ILEGIVEL).toBe('[ilegível]')
    for (const i of [INSTRUCAO_DA_IMAGEM, INSTRUCAO_DO_DOCUMENTO]) {
      expect(i).toContain('write [ilegível] in its place — never complete or guess it')
    }
  })

  it('⚠️ os FATOS vêm no TOPO: o agente recebe só os primeiros 4.000 caracteres', () => {
    const pedido = 'Begin the reply with the line "FATOS:" followed by 3 to 6 short lines'
    // O documento SEMPRE começa pelos fatos — e a instrução também, antes do texto.
    expect(INSTRUCAO_DO_DOCUMENTO.startsWith(pedido)).toBe(true)
    expect(INSTRUCAO_DO_DOCUMENTO.indexOf('FATOS:')).toBeLessThan(INSTRUCAO_DO_DOCUMENTO.indexOf('extract the text content'))
    // A imagem, só quando é documento: a foto e o print de conversa não têm fatos.
    expect(INSTRUCAO_DA_IMAGEM).toContain('If the image shows a document (contract, statement, bill, payslip, ID, work card, medical or court paper): ' + pedido)
    expect(INSTRUCAO_DA_IMAGEM).toContain('If it is not a document (a photo, a chat screenshot), do not write the FATOS block.')
    for (const i of [INSTRUCAO_DA_IMAGEM, INSTRUCAO_DO_DOCUMENTO]) {
      expect(i).toContain('key facts of the WHOLE file')
      // Os fatos seguem as regras do texto: só o escrito, e [ilegível].
      expect(i).toContain('Use only what is written in the file — write [ilegível] for anything you cannot read with certainty')
      // O teto de ~6.000 inclui os fatos.
      expect(i).toContain('6,000 characters')
      expect(i).not.toContain('no comments, no labels')
    }
  })
})

describe('falhaPassageira — a falha que NÃO é do arquivo', () => {
  it('chave, modelo, cota e provedor fora do ar não contam; o resto é o arquivo', () => {
    for (const s of [401, 403, 404, 408, 409, 425, 429, 500, 502, 503, 504, 529]) expect(falhaPassageira(s)).toBe(true)
    for (const s of [400, 413, 415, 422]) expect(falhaPassageira(s)).toBe(false)
  })
})

describe('nomeParaOProvedor', () => {
  it('⚠️ o documento vai SEMPRE com ".pdf" (a OpenAI, a única que usa o nome, decide o formato por ele e só lê PDF)', () => {
    expect(nomeParaOProvedor('extrato.pdf', 'documento')).toBe('extrato.pdf')
    expect(nomeParaOProvedor('Extrato.PDF', 'documento')).toBe('Extrato.PDF')
    expect(nomeParaOProvedor('Extrato setembro', 'documento')).toBe('Extrato setembro.pdf')
    expect(nomeParaOProvedor('scan.bin', 'documento')).toBe('scan.bin.pdf')
    expect(nomeParaOProvedor('  ', 'documento')).toBe('documento.pdf')
    expect(nomeParaOProvedor(null, 'documento')).toBe('documento.pdf')
    const longo = nomeParaOProvedor('x'.repeat(300), 'documento')
    expect(longo.endsWith('.pdf')).toBe(true)
    expect(longo.length).toBeLessThanOrEqual(200)
  })

  it('a imagem mantém o nome (ou "imagem")', () => {
    expect(nomeParaOProvedor('foto.jpg', 'imagem')).toBe('foto.jpg')
    expect(nomeParaOProvedor(null, 'imagem')).toBe('imagem')
  })
})

describe('erroDoProvedor', () => {
  it('recusa de chave não leva o corpo (a OpenAI ecoa parte da chave)', () => {
    expect(erroDoProvedor('openai', 401, 'Incorrect API key provided: sk-proj-abc…wxyz', 'sk-proj-abcdefwxyz')).toBe(
      'OpenAI recusou a chave (HTTP 401)',
    )
  })

  it('outros erros levam o corpo, sem a chave', () => {
    const e = erroDoProvedor('anthropic', 400, 'bad request for key a-segredo', 'a-segredo')
    expect(e).toContain('Anthropic respondeu HTTP 400')
    expect(e).not.toContain('a-segredo')
  })
})
