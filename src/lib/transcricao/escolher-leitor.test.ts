import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ia-chaves/repo', () => ({ lerChave: vi.fn() }))

import type { AiProvider } from '@/lib/ai/types'
import { lerChave } from '@/lib/ia-chaves/repo'

import { escolherLeitor } from './escolher-leitor'

type Lida = Awaited<ReturnType<typeof lerChave>>

function chaves(por: Partial<Record<AiProvider, Lida | Error>>): void {
  vi.mocked(lerChave).mockImplementation(async (_conta, provedor) => {
    const v = por[provedor] ?? { chave: null, ilegivel: false }
    if (v instanceof Error) throw v
    return v
  })
}

beforeEach(() => {
  vi.mocked(lerChave).mockReset()
})

describe('escolherLeitor — a primeira chave que a conta tem, na ordem pedida', () => {
  it('Gemini primeiro, sem nem perguntar pelos outros', async () => {
    chaves({ gemini: { chave: 'g', ilegivel: false }, openai: { chave: 'o', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai', 'anthropic'])).toEqual({ ok: true, provedor: 'gemini', chave: 'g' })
    expect(lerChave).toHaveBeenCalledTimes(1)
  })

  it('sem Gemini, a OpenAI; sem as duas, a Anthropic', async () => {
    chaves({ openai: { chave: 'o', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai', 'anthropic'])).toMatchObject({ provedor: 'openai' })
    chaves({ anthropic: { chave: 'a', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai', 'anthropic'])).toMatchObject({ provedor: 'anthropic' })
  })

  it('a ordem do ÁUDIO não tem a Anthropic: só ela = sem chave', async () => {
    chaves({ anthropic: { chave: 'a', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai'])).toEqual({ ok: false, motivo: 'sem_chave' })
    expect(vi.mocked(lerChave).mock.calls.map((c) => c[1])).toEqual(['gemini', 'openai'])
  })

  it('a chave da OpenAI "só da base" (1047) é pulada', async () => {
    chaves({ openai: { chave: 'o', ilegivel: false, soDaBase: true }, anthropic: { chave: 'a', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai', 'anthropic'])).toMatchObject({ provedor: 'anthropic' })
  })

  it('chave ilegível é pulada; sem nenhuma que sirva, "ilegível" (não "sem chave")', async () => {
    chaves({ gemini: { chave: null, ilegivel: true }, openai: { chave: 'o', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai'])).toMatchObject({ provedor: 'openai' })
    chaves({ gemini: { chave: null, ilegivel: true } })
    expect(await escolherLeitor('a1', ['gemini', 'openai'])).toEqual({ ok: false, motivo: 'ilegivel' })
  })

  it('⚠️ erro de LEITURA para a escolha — não cai para o próximo provedor', async () => {
    chaves({ gemini: new Error('timeout'), openai: { chave: 'o', ilegivel: false } })
    expect(await escolherLeitor('a1', ['gemini', 'openai'])).toEqual({ ok: false, motivo: 'erro' })
    expect(lerChave).toHaveBeenCalledTimes(1)
  })
})
