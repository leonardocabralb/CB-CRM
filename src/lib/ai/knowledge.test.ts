import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { retrieveKnowledge, ingestDocument } from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  inserted: Record<string, unknown>[] | null
  /** Os trechos que o documento JÁ tem (a lista paginada por chave os lê). */
  existingChunkIds: string[]
  /** O que a lista dos antigos filtrou (conta e documento). */
  listedWith: Record<string, unknown>[]
  deletedIds: string[] | null
  /** A ordem das escritas e leituras do reprocessamento. */
  events: string[]
  listError: { message: string } | null
  insertError: { message: string } | null
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    inserted: null,
    existingChunkIds: ['old-1', 'old-2'],
    listedWith: [],
    deletedIds: null,
    events: [],
    listError: null,
    insertError: null,
  }
  const db = {
    rpc: (name: string) => {
      state.rpcCalls.push(name)
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({
      select: (_cols: string, opts?: { head?: boolean }) => {
        const filtros: Record<string, unknown> = {}
        let depoisDe: string | null = null
        let limite = Infinity
        const resultado = () => {
          // retrieveKnowledge's empty-KB count guard.
          if (opts?.head) return { count: state.chunkCount, error: null }
          state.events.push('list')
          state.listedWith.push({ ...filtros })
          if (state.listError) return { data: null, error: state.listError }
          const pagina = [...state.existingChunkIds]
            .sort()
            .filter((id) => depoisDe === null || id > depoisDe)
            .slice(0, limite)
          return { data: pagina.map((id) => ({ id })), error: null }
        }
        const chain = {
          eq: (col: string, val: unknown) => {
            filtros[col] = val
            return chain
          },
          gt: (_col: string, val: string) => {
            depoisDe = val
            return chain
          },
          order: () => chain,
          limit: (n: number) => {
            limite = n
            return chain
          },
          then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(resultado()).then(resolve, reject),
        }
        return chain
      },
      delete: () => {
        const chain = {
          eq: () => chain,
          in: (_col: string, ids: string[]) => {
            state.events.push('delete')
            state.deletedIds = [...(state.deletedIds ?? []), ...ids]
            return Promise.resolve({ error: null })
          },
        }
        return chain
      },
      insert: (rows: Record<string, unknown>[]) => {
        state.events.push('insert')
        if (state.insertError) return Promise.resolve({ error: state.insertError })
        state.inserted = rows
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'F1'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedIds).toEqual(['old-1', 'old-2'])
    expect(state.listedWith[0]).toEqual({ account_id: 'acct', document_id: 'doc-1' })
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
  })

  // Porte do #683 do original: os antigos só saem depois de os novos
  // estarem gravados — apagando primeiro, o documento ficava sem trecho
  // durante o embedding e para sempre se o INSERT falhasse.
  it('os trechos antigos ficam até o embedding acabar e os novos estarem gravados', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockImplementationOnce(async (_key: string, inputs: string[]) => {
      expect(state.events).toEqual([])
      return inputs.map((_, i) => [i, i])
    })
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(state.events).toEqual(['list', 'insert', 'delete'])
  })

  it('INSERT que falha não apaga nada: os antigos continuam servindo', async () => {
    const { db, state } = makeDb()
    state.insertError = { message: 'insert failed' }
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world'),
    ).rejects.toMatchObject({ message: 'insert failed' })
    expect(state.deletedIds).toBeNull()
  })

  it('lista dos antigos que falha não grava nem apaga', async () => {
    const { db, state } = makeDb()
    state.listError = { message: 'list failed' }
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world'),
    ).rejects.toThrow(/not listed/)
    expect(state.inserted).toBeNull()
    expect(state.deletedIds).toBeNull()
  })

  it('a lista dos antigos passa de 1000 POR CHAVE e apaga em lotes de 100', async () => {
    const { db, state } = makeDb()
    state.existingChunkIds = Array.from(
      { length: 1050 },
      (_, i) => `old-${String(i).padStart(4, '0')}`,
    )
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(state.events.filter((e) => e === 'list')).toHaveLength(2)
    expect(state.events.filter((e) => e === 'delete')).toHaveLength(11)
    expect(new Set(state.deletedIds)).toEqual(new Set(state.existingChunkIds))
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedIds).toEqual(['old-1', 'old-2'])
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world'),
    ).rejects.toThrow('rate limited')
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
    // …and the old ones were replaced BEFORE the rethrow (the contract).
    expect(state.events).toEqual(['list', 'insert', 'delete'])
  })
})
