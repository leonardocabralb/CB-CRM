import { describe, it, expect, vi, beforeEach } from 'vitest'

// O proxy de mídia da Meta responde no NOSSO domínio, com o tipo que o
// CLIENTE mandou (upstream #678). Arquivo próprio, e não o `route.test.ts` do
// original: lá a rota não tem o `?channel=` nem o `whatsapp_config` por
// `maybeSingle`, e o arquivo dele viraria conflito add/add no próximo merge.

const h = vi.hoisted(() => ({
  downloadContentType: 'image/jpeg' as string | null,
  metaMimeType: 'image/jpeg',
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === 'profiles'
              ? { account_id: 'acc-1' }
              : table === 'whatsapp_config'
                ? { access_token: 'enc-token' }
                : null,
        }),
      }
      return chain
    },
  }),
}))

vi.mock('@/lib/cb-channels/repo', () => ({ getChannelWithSecrets: async () => null }))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => `plain-${v}` }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: async () => ({ url: 'https://lookaside.example/m', mimeType: h.metaMimeType, fileSize: 3 }),
  downloadMedia: async () => ({ buffer: Buffer.from('abc'), contentType: h.downloadContentType }),
}))

import { GET } from './route'

function call(mediaId = '1234567890') {
  return GET(new Request(`http://localhost/api/whatsapp/media/${mediaId}`), {
    params: Promise.resolve({ mediaId }),
  })
}

beforeEach(() => {
  h.downloadContentType = 'image/jpeg'
  h.metaMimeType = 'image/jpeg'
})

describe('GET /api/whatsapp/media/[mediaId] — cabeçalhos', () => {
  it('foto vai inline, com nosniff, sandbox e cache privado', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/jpeg')
    expect(res.headers.get('Content-Disposition')).toBe('inline')
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(res.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox")
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400')
  })

  it('documento HTML do cliente vira download, nunca página no nosso domínio', async () => {
    h.downloadContentType = 'text/html; charset=utf-8'
    h.metaMimeType = 'text/html'
    const res = await call()
    expect(res.headers.get('Content-Type')).toBe('text/html')
    expect(res.headers.get('Content-Disposition')).toBe('attachment')
  })

  it('SVG (que roda script quando aberto) vira download', async () => {
    h.downloadContentType = 'image/svg+xml'
    h.metaMimeType = 'image/svg+xml'
    const res = await call()
    expect(res.headers.get('Content-Disposition')).toBe('attachment')
  })

  it('sem tipo da CDN, vale o tipo da Meta; PDF sai como download com o nome do id', async () => {
    h.downloadContentType = null
    h.metaMimeType = 'application/pdf'
    const res = await call('987')
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="987.pdf"')
  })

  it('áudio do WhatsApp (ogg com parâmetro) toca inline, com o tipo base', async () => {
    h.downloadContentType = 'audio/ogg; codecs=opus'
    const res = await call()
    expect(res.headers.get('Content-Type')).toBe('audio/ogg')
    expect(res.headers.get('Content-Disposition')).toBe('inline')
  })
})
