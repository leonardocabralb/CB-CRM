import { afterEach, describe, expect, it, vi } from 'vitest'

import { subirAoGemini, urlDoEnvioValida } from './arquivo-do-gemini'

// ============================================================
// O envio do documento grande ao Gemini (Files API): a URL que vem da
// resposta só é seguida no host dele, e o arquivo CRIADO é apagado em toda
// saída sem sucesso (Codex, #476: a consulta do estado que cai na rede
// deixava o documento do cliente no Google até a expiração).
// ============================================================

type FetchFalso = (url: string, init?: RequestInit) => Promise<unknown>
const INICIO = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
const ENVIO = 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=xyz'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('urlDoEnvioValida', () => {
  it('só https no host do Gemini', () => {
    expect(urlDoEnvioValida(ENVIO)).toBe(ENVIO)
    expect(urlDoEnvioValida('http://generativelanguage.googleapis.com/x')).toBeNull()
    expect(urlDoEnvioValida('https://generativelanguage.googleapis.com.intruso.com/x')).toBeNull()
    expect(urlDoEnvioValida('https://intruso.example.com/up')).toBeNull()
    expect(urlDoEnvioValida('não é url')).toBeNull()
    expect(urlDoEnvioValida(null)).toBeNull()
  })
})

describe('subirAoGemini', () => {
  function fetchFalso(estado: 'ACTIVE' | 'PROCESSING', consulta: 'rede' | 'FAILED' = 'rede') {
    return vi.fn<FetchFalso>(async (url, init) => {
      if (url === INICIO) return { ok: true, status: 200, headers: { get: (h: string) => (h === 'x-goog-upload-url' ? ENVIO : null) } }
      if (url === ENVIO) return { ok: true, status: 200, json: async () => ({ file: { name: 'files/abc123', uri: 'u', state: estado } }) }
      if (url.endsWith('/v1beta/files/abc123') && init?.method === 'DELETE') return { ok: true, status: 200 }
      if (url.endsWith('/v1beta/files/abc123')) {
        if (consulta === 'rede') throw new TypeError('fetch failed')
        return { ok: true, status: 200, json: async () => ({ state: 'FAILED' }) }
      }
      throw new Error(`chamada inesperada: ${url}`)
    })
  }
  const args = { chave: 'g-1', bytes: new Uint8Array([1, 2, 3]), mime: 'application/pdf', signal: new AbortController().signal }

  it('já ACTIVE: devolve nome e uri, sem consultar nem apagar', async () => {
    const f = fetchFalso('ACTIVE')
    vi.stubGlobal('fetch', f)
    expect(await subirAoGemini(args)).toEqual({ ok: true, nome: 'files/abc123', uri: 'u' })
    expect(f.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false)
  })

  it('⚠️ a consulta do estado cai na rede: falha passageira E o arquivo criado é APAGADO', async () => {
    const f = fetchFalso('PROCESSING', 'rede')
    vi.stubGlobal('fetch', f)
    const r = await subirAoGemini(args)
    expect(r).toMatchObject({ ok: false, status: null })
    await vi.waitFor(() => expect(f.mock.calls.some((c) => String(c[0]).endsWith('/files/abc123') && c[1]?.method === 'DELETE')).toBe(true))
  })

  it('o Gemini não processou (FAILED): falha que conta (422) e o arquivo é apagado', async () => {
    const f = fetchFalso('PROCESSING', 'FAILED')
    vi.stubGlobal('fetch', f)
    expect(await subirAoGemini(args)).toMatchObject({ ok: false, status: 422 })
    await vi.waitFor(() => expect(f.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true))
  })
})
