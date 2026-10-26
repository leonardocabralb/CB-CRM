import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Os modelos que a chave da CONTA oferece (25/10/2026). O que se segura:
// a chave só no CABEÇALHO (nunca na URL), a paginação montada sobre a URL do
// provedor, os recortes de texto, a falha como CÓDIGO (sem a chave no log) e
// o cache por conta + provedor + chave. Chaves e ids fictícios.
// ============================================================

const lerChave = vi.fn()
vi.mock('@/lib/ia-chaves/repo', () => ({ lerChave: (...a: unknown[]) => lerChave(...a) }))

import {
  ehModeloDeTextoDaOpenai,
  ehModeloDeTextoDoGemini,
  limparCacheDosModelos,
  modelosDaConta,
  URL_DOS_MODELOS,
} from './modelos-da-chave'

const CHAVE = 'chave-ficticia-0123456789'

type Resposta = { status?: number; corpo: unknown }
let respostas: Resposta[] = []
const pedidos: { url: string; headers: Record<string, string> }[] = []

function responder(...r: Resposta[]) {
  respostas = r
}

beforeEach(() => {
  limparCacheDosModelos()
  respostas = []
  pedidos.length = 0
  lerChave.mockReset()
  lerChave.mockResolvedValue({ chave: CHAVE, ilegivel: false })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      pedidos.push({ url, headers: init.headers })
      const r = respostas.shift() ?? { corpo: {} }
      const status = r.status ?? 200
      return new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo), { status })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Anthropic', () => {
  it('x-api-key + anthropic-version no cabeçalho, nunca na URL; pagina por after_id', async () => {
    responder(
      { corpo: { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }], has_more: true, last_id: 'claude-haiku-5-5' } },
      { corpo: { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }], has_more: false, last_id: 'claude-opus-5-5' } },
    )
    const r = await modelosDaConta('conta-1', 'anthropic')
    expect(r.modelos).toEqual({
      ok: true,
      modelos: [
        { id: 'claude-haiku-5-5', nome: 'Claude Haiku 5.5' },
        { id: 'claude-opus-5-5', nome: 'Claude Opus 5.5' },
      ],
    })
    expect(pedidos).toHaveLength(2)
    expect(pedidos[0].headers['x-api-key']).toBe(CHAVE)
    expect(pedidos[0].headers['anthropic-version']).toBe('2023-06-01')
    for (const p of pedidos) {
      expect(p.url.startsWith(URL_DOS_MODELOS.anthropic)).toBe(true)
      expect(p.url).not.toContain(CHAVE)
    }
    expect(new URL(pedidos[0].url).searchParams.get('limit')).toBe('1000')
    expect(new URL(pedidos[1].url).searchParams.get('after_id')).toBe('claude-haiku-5-5')
  })

  it('o cursor que não avança é falha (nunca laço até o teto)', async () => {
    responder(
      { corpo: { data: [{ id: 'a' }], has_more: true, last_id: 'a' } },
      { corpo: { data: [{ id: 'b' }], has_more: true, last_id: 'a' } },
    )
    const r = await modelosDaConta('conta-1', 'anthropic')
    expect(r.modelos).toEqual({ ok: false, motivo: 'falhou', codigo: 'resposta_estranha' })
  })
})

describe('Gemini', () => {
  it('x-goog-api-key no cabeçalho (nunca ?key=); pageToken; só os de texto, sem o prefixo models/', async () => {
    responder(
      {
        corpo: {
          models: [
            { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
            { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] },
          ],
          nextPageToken: 'pagina-2',
        },
      },
      {
        corpo: {
          models: [
            { name: 'models/gemini-3.6-flash', displayName: 'Gemini 3.6 Flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/imagen-9', supportedGenerationMethods: ['generateContent'] },
          ],
        },
      },
    )
    const r = await modelosDaConta('conta-1', 'gemini')
    expect(r.modelos).toEqual({
      ok: true,
      modelos: [
        { id: 'gemini-3.8-flash', nome: 'Gemini 3.8 Flash' },
        { id: 'gemini-3.6-flash', nome: 'Gemini 3.6 Flash' },
      ],
    })
    expect(pedidos[0].headers['x-goog-api-key']).toBe(CHAVE)
    for (const p of pedidos) {
      expect(p.url.startsWith(URL_DOS_MODELOS.gemini)).toBe(true)
      expect(new URL(p.url).searchParams.get('key')).toBeNull()
      expect(p.url).not.toContain(CHAVE)
    }
    expect(new URL(pedidos[1].url).searchParams.get('pageToken')).toBe('pagina-2')
  })

  it('o recorte de texto do Gemini', () => {
    const com = (name: string, metodos = ['generateContent']) => ehModeloDeTextoDoGemini({ name, supportedGenerationMethods: metodos })
    expect(com('models/gemini-3.8-flash')).toBe(true)
    expect(com('models/gemini-3.8-flash', ['countTokens'])).toBe(false)
    for (const fora of ['gemini-embedding-9', 'imagen-9', 'gemini-3-flash-image', 'nano-banana-pro-preview', 'gemini-nano-banana-2.1', 'veo-9', 'gemini-3-flash-tts', 'aqa', 'gemini-3.5-transcribe', 'gemini-3-flash-native-audio']) {
      expect(com(`models/${fora}`), fora).toBe(false)
    }
    expect(ehModeloDeTextoDoGemini(null)).toBe(false)
  })
})

describe('OpenAI', () => {
  it('Bearer no cabeçalho; só os de texto, o mais novo primeiro', async () => {
    responder({
      corpo: {
        data: [
          { id: 'gpt-5.4', created: 2 },
          { id: 'whisper-9', created: 9 },
          { id: 'gpt-5.4-mini', created: 3 },
          { id: 'text-embedding-9', created: 8 },
        ],
      },
    })
    const r = await modelosDaConta('conta-1', 'openai')
    expect(r.modelos).toEqual({
      ok: true,
      modelos: [
        { id: 'gpt-5.4-mini', nome: 'gpt-5.4-mini' },
        { id: 'gpt-5.4', nome: 'gpt-5.4' },
      ],
    })
    expect(pedidos[0].headers.Authorization).toBe(`Bearer ${CHAVE}`)
    expect(pedidos[0].url).toBe(URL_DOS_MODELOS.openai)
  })

  it('o recorte de texto da OpenAI', () => {
    for (const dentro of ['gpt-5.4-mini', 'gpt-4o', 'o3', 'o4-mini', 'chatgpt-4o-latest']) {
      expect(ehModeloDeTextoDaOpenai(dentro), dentro).toBe(true)
    }
    for (const fora of [
      'gpt-4o-audio-preview',
      'gpt-realtime',
      'gpt-4o-transcribe',
      'gpt-4o-mini-tts',
      'gpt-image-1',
      'text-embedding-3-small',
      'omni-moderation-latest',
      'gpt-4o-search-preview',
      'gpt-3.5-turbo-instruct',
      'gpt-5-codex',
      'o3-deep-research',
      'o3-pro',
      'dall-e-3',
      'whisper-1',
      'ft:gpt-4o-mini:org:x',
    ]) {
      expect(ehModeloDeTextoDaOpenai(fora), fora).toBe(false)
    }
  })
})

describe('falhas', () => {
  it('401 = invalid_key; a mensagem do provedor (que ecoa a chave) não sai, e o log vem sem ela', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    responder({ status: 401, corpo: { error: { message: `Incorrect API key provided: ${CHAVE}` } } })
    const r = await modelosDaConta('conta-1', 'openai')
    expect(r.modelos).toEqual({ ok: false, motivo: 'falhou', codigo: 'invalid_key' })
    expect(JSON.stringify(r)).not.toContain(CHAVE)
    expect(erro.mock.calls.flat().join(' ')).not.toContain(CHAVE)
    expect(erro.mock.calls.flat().join(' ')).toContain('[chave]')
  })

  it('429 = rate_limited; 500 = provider_error; corpo que não é JSON = resposta_estranha', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    responder({ status: 429, corpo: {} })
    expect((await modelosDaConta('conta-1', 'openai')).modelos).toMatchObject({ codigo: 'rate_limited' })
    responder({ status: 500, corpo: {} })
    expect((await modelosDaConta('conta-1', 'openai')).modelos).toMatchObject({ codigo: 'provider_error' })
    responder({ corpo: 'não é json' })
    expect((await modelosDaConta('conta-1', 'openai')).modelos).toMatchObject({ codigo: 'resposta_estranha' })
  })

  it('tempo esgotado = timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('estourou', 'TimeoutError')
      }),
    )
    expect((await modelosDaConta('conta-1', 'gemini')).modelos).toEqual({ ok: false, motivo: 'falhou', codigo: 'timeout' })
  })
})

describe('a chave da conta', () => {
  it('sem chave = sem_chave, sem chamar o provedor; e não lê a mídia', async () => {
    lerChave.mockResolvedValue({ chave: null, ilegivel: false })
    expect(await modelosDaConta('conta-1', 'gemini')).toEqual({ modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false })
    expect(pedidos).toHaveLength(0)
  })

  it('a OpenAI "só da base" (1047) = sem_chave: nenhuma tela a oferece ao chat, nem a leitura a usa', async () => {
    lerChave.mockResolvedValue({ chave: CHAVE, ilegivel: false, soDaBase: true })
    expect(await modelosDaConta('conta-1', 'openai')).toEqual({ modelos: { ok: false, motivo: 'sem_chave' }, leAMidia: false })
    expect(pedidos).toHaveLength(0)
  })

  it('chave ilegível = falhou (chave_ilegivel), e a leitura a pula', async () => {
    lerChave.mockResolvedValue({ chave: null, ilegivel: true })
    expect(await modelosDaConta('conta-1', 'gemini')).toEqual({
      modelos: { ok: false, motivo: 'falhou', codigo: 'chave_ilegivel' },
      leAMidia: false,
    })
  })

  it('leitura do banco que falha = falhou (leitura_falhou), e não se sabe quem lê (null)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    lerChave.mockRejectedValue(new Error('[ia-chaves] leitura falhou: x'))
    expect(await modelosDaConta('conta-1', 'gemini')).toEqual({
      modelos: { ok: false, motivo: 'falhou', codigo: 'leitura_falhou' },
      leAMidia: null,
    })
  })

  it('a lista que falha não diz que a chave não lê a mídia', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    responder({ status: 503, corpo: {} })
    expect((await modelosDaConta('conta-1', 'gemini')).leAMidia).toBe(true)
  })
})

describe('cache por conta, provedor e chave', () => {
  const lista = { corpo: { data: [{ id: 'gpt-5.4-mini', created: 1 }] } }

  it('a segunda leitura vem do cache; `atualizar` lê de novo', async () => {
    responder(lista, lista)
    await modelosDaConta('conta-1', 'openai')
    await modelosDaConta('conta-1', 'openai')
    expect(pedidos).toHaveLength(1)
    await modelosDaConta('conta-1', 'openai', { atualizar: true })
    expect(pedidos).toHaveLength(2)
  })

  it('trocar a chave (outra impressão) lê de novo na hora; outra conta também', async () => {
    responder(lista, lista, lista)
    await modelosDaConta('conta-1', 'openai')
    lerChave.mockResolvedValue({ chave: 'outra-chave-ficticia-987654', ilegivel: false })
    await modelosDaConta('conta-1', 'openai')
    await modelosDaConta('conta-2', 'openai')
    expect(pedidos).toHaveLength(3)
  })

  it('falha NÃO entra no cache', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    responder({ status: 503, corpo: {} }, lista)
    expect((await modelosDaConta('conta-1', 'openai')).modelos.ok).toBe(false)
    expect((await modelosDaConta('conta-1', 'openai')).modelos.ok).toBe(true)
  })

  it('vence em 10 minutos', async () => {
    responder(lista, lista)
    const agora = Date.now()
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(agora)
    await modelosDaConta('conta-1', 'openai')
    relogio.mockReturnValue(agora + 10 * 60_000 + 1)
    await modelosDaConta('conta-1', 'openai')
    expect(pedidos).toHaveLength(2)
  })
})
