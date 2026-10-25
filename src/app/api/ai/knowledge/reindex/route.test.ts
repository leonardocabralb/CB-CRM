import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// POST /api/ai/knowledge/reindex — um documento que falha não para os outros
// (porte do upstream #676, adaptado: o nosso `ingestDocument` LANÇA quando o
// embedding falha, então não há o balde `keyword_only` do original, e a
// resposta leva o `motivo` seguro quando a falha é do provedor).
// ============================================================

const h = vi.hoisted(() => ({
  docs: [] as { id: string; content: string }[],
  corrupt: false,
  ingest: vi.fn(),
}))

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({
    accountId: 'acc-1',
    userId: 'user-1',
    role: 'admin',
    supabase: {
      from: () => ({
        select: () => ({
          eq: async () => ({ data: h.docs, error: null }),
        }),
      }),
    },
  }),
  toErrorResponse: (err: unknown) => ({
    body: { error: err instanceof Error ? err.message : 'error' },
    status: 500,
  }),
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: async () => ({ key: 'sk-embed', corrupt: h.corrupt }),
}))

vi.mock('@/lib/ai/knowledge', () => ({ ingestDocument: h.ingest }))

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { AiError } from '@/lib/ai/types'

function reindex() {
  return POST() as unknown as Promise<{ status: number; body: Record<string, unknown> }>
}

let erroNoLog: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  __resetRateLimitForTests()
  h.corrupt = false
  h.docs = [
    { id: 'doc-1', content: 'um' },
    { id: 'doc-2', content: 'dois' },
    { id: 'doc-3', content: 'três' },
  ]
  h.ingest.mockReset()
  h.ingest.mockResolvedValue(undefined)
  erroNoLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/ai/knowledge/reindex', () => {
  it('reindexa todos os documentos', async () => {
    const res = await reindex()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true, reindexed: 3, total: 3, failed: [] })
  })

  it('segue depois de um documento que falha e diz QUAL falhou', async () => {
    h.ingest.mockImplementation(async (_db, _conta, _cfg, id: string) => {
      if (id === 'doc-1') throw new Error('insert failed')
    })
    const res = await reindex()
    expect(h.ingest).toHaveBeenCalledTimes(3)
    expect(res.body).toEqual({
      success: false,
      reindexed: 2,
      total: 3,
      failed: ['doc-1'],
      // Erro que não é do provedor (banco): sem motivo — vai inteiro ao log, e
      // a frase da tela já diz quais falharam.
    })
  })

  it('junta os que falharam pelo banco, sem motivo (não é do provedor)', async () => {
    h.ingest.mockImplementation(async (_db, _conta, _cfg, id: string) => {
      if (id === 'doc-1') throw new Error('insert failed')
      if (id === 'doc-3') throw new Error('delete failed')
    })
    const res = await reindex()
    expect(h.ingest).toHaveBeenCalledTimes(3)
    expect(res.body).toMatchObject({
      success: false,
      reindexed: 1,
      total: 3,
      failed: ['doc-1', 'doc-3'],
    })
    expect(res.body).not.toHaveProperty('motivo')
  })

  // ⚠️ NOSSO: `ingestDocument` apaga os trechos antes de gerar os vetores, e a
  // falha do provedor é da conta — seguir tiraria os vetores de TODOS.
  it('a falha do PROVEDOR encerra a rodada: os documentos seguintes ficam como estavam', async () => {
    h.ingest.mockImplementation(async (_db, _conta, _cfg, id: string) => {
      if (id === 'doc-2') throw new AiError('Rate limit reached', { code: 'rate_limited', status: 429 })
    })
    const res = await reindex()
    expect(h.ingest).toHaveBeenCalledTimes(2)
    expect(res.body).toMatchObject({
      success: false,
      reindexed: 1,
      total: 3,
      failed: ['doc-2'],
      motivo: 'Rate limit reached',
    })
  })

  it('⚠️ chave recusada: para no primeiro, e nem a tela nem o log recebem a mensagem crua (ela ecoa a chave)', async () => {
    h.ingest.mockRejectedValue(
      new AiError('Incorrect API key provided: sk-proj-segredo', { code: 'invalid_key', status: 401 }),
    )
    const res = await reindex()
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(res.body).toMatchObject({ success: false, reindexed: 0, total: 3, failed: ['doc-1'] })
    expect(JSON.stringify(res.body)).not.toContain('sk-proj-segredo')
    expect(JSON.stringify(erroNoLog.mock.calls)).not.toContain('sk-proj-segredo')
  })

  it('para antes de indexar quando a chave de embeddings não decifra', async () => {
    h.corrupt = true
    const res = await reindex()
    expect(h.ingest).not.toHaveBeenCalled()
    expect(res.body).toMatchObject({ success: false, reindexed: 0 })
  })
})
