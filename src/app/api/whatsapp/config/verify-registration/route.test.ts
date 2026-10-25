import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/whatsapp/config/verify-registration — o balde `whatsappAdmin`
// (porte do upstream #660): cada pedido faz duas idas à Graph API.
// ============================================================

const h = vi.hoisted(() => ({ leiturasDoPerfil: 0 }))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json', ...init?.headers },
      }),
  },
}))

// Perfil sem conta: o pedido que passa do limite volta cedo, sem ir à Meta.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            h.leiturasDoPerfil += 1
            return { data: null, error: null }
          },
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  getSubscribedApps: async () => {
    throw new Error('não deveria ir à Meta')
  },
  verifyPhoneNumber: async () => {
    throw new Error('não deveria ir à Meta')
  },
}))

import { GET } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

beforeEach(() => {
  __resetRateLimitForTests()
  h.leiturasDoPerfil = 0
})

describe('GET /api/whatsapp/config/verify-registration — limite por usuário', () => {
  it('o pedido que passa do balde é 429, com Retry-After, antes de ler o perfil', async () => {
    for (let i = 0; i < 30; i++) {
      expect((await GET()).status).toBe(200)
    }
    const recusado = await GET()
    expect(recusado.status).toBe(429)
    expect(recusado.headers.get('Retry-After')).toBeTruthy()
    expect(h.leiturasDoPerfil).toBe(30)
  })
})
