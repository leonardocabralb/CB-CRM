import { describe, it, expect, vi } from 'vitest'
import { logAiUsage } from './usage'
import type { SupabaseClient } from '@supabase/supabase-js'

function fakeDb() {
  const insert = vi.fn().mockResolvedValue({ error: null })
  const db = { from: vi.fn(() => ({ insert })) }
  return { db: db as unknown as SupabaseClient, insert, from: db.from }
}

describe('logAiUsage', () => {
  it('inserts a row mapping normalized usage to the log columns', async () => {
    const { db, insert, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
    expect(from).toHaveBeenCalledWith('ai_usage_log')
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      mode: 'auto_reply',
      // Multi-canal: null quando o chamador nao informa o canal.
      channel_id: null,
      provider: 'anthropic',
      model: 'claude-x',
      prompt_tokens: 30,
      completion_tokens: 6,
      total_tokens: 36,
    })
  })

  it('NOSSO (1129): grava as partes do CACHE só quando houve', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'agente',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      usage: { promptTokens: 10_818, completionTokens: 500, totalTokens: 11_318, cacheReadTokens: 10_518 },
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ prompt_tokens: 10_818, cache_leitura_tokens: 10_518 }),
    )
    expect(insert.mock.calls[0][0]).not.toHaveProperty('cache_escrita_tokens')
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'agente',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      usage: { promptTokens: 10_685, completionTokens: 272, totalTokens: 10_957, cacheWriteTokens: 10_518 },
    })
    expect(insert.mock.calls[1][0]).toMatchObject({ cache_escrita_tokens: 10_518 })
    expect(insert.mock.calls[1][0]).not.toHaveProperty('cache_leitura_tokens')
  })

  it('is a no-op when the provider reported no usage', async () => {
    const { db, from } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: null,
      mode: 'draft',
      provider: 'openai',
      model: 'gpt-x',
      usage: null,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('never throws when the insert errors', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { message: 'boom' } })
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
    await expect(
      logAiUsage(db, {
        accountId: 'acct-1',
        conversationId: 'conv-1',
        mode: 'draft',
        provider: 'openai',
        model: 'gpt-x',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),
    ).resolves.toBeUndefined()
  })
})

describe('logAiUsage — canal', () => {
  it('atribui o custo ao canal quando informado', async () => {
    const { db, insert } = fakeDb()
    await logAiUsage(db, {
      accountId: 'acct-1',
      conversationId: 'conv-1',
      mode: 'auto_reply',
      channelId: 'ch-juridico',
      provider: 'anthropic',
      model: 'claude-x',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    })
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: 'ch-juridico' }),
    )
  })
})
