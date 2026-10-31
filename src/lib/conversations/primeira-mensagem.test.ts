import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { reivindicarPrimeiraMensagem } from './primeira-mensagem'

// ============================================================
// A reivindicação da primeira mensagem (1105). O dublê segue a régua do
// UPDATE condicional (`first_inbound_at IS NULL`): a primeira escrita leva a
// linha, a seguinte volta vazia. O que ele NÃO prova é o banco — a espera da
// trava e a releitura da linha sob READ COMMITTED foram medidas num Postgres
// 16 descartável, com duas sessões (descrição do PR).
// ============================================================

interface Chamada {
  tabela: string
  patch: Record<string, unknown>
  eq?: [string, unknown]
  is?: [string, unknown]
  colunas?: string
}

function banco(opcoes: { jaLevada?: boolean; erro?: { message: string }; lanca?: boolean } = {}) {
  const chamadas: Chamada[] = []
  let levada = opcoes.jaLevada ?? false
  const db = {
    from: (tabela: string) => ({
      update: (patch: Record<string, unknown>) => {
        const chamada: Chamada = { tabela, patch }
        chamadas.push(chamada)
        return {
          eq: (coluna: string, valor: unknown) => {
            chamada.eq = [coluna, valor]
            return {
              is: (col: string, v: unknown) => {
                chamada.is = [col, v]
                return {
                  select: async (colunas: string) => {
                    chamada.colunas = colunas
                    if (opcoes.lanca) throw new Error('rede caiu')
                    if (opcoes.erro) return { data: null, error: opcoes.erro }
                    if (levada) return { data: [], error: null }
                    levada = true
                    return { data: [{ id: valor }], error: null }
                  },
                }
              },
            }
          },
        }
      },
    }),
  } as unknown as SupabaseClient
  return { db, chamadas }
}

const AGORA = new Date('2026-10-25T12:00:00.000Z')
const ZERO = { count: 0, error: null }

describe('reivindicarPrimeiraMensagem (1105)', () => {
  it('contagem zero: reivindica a conversa pelo UPDATE condicional e é a primeira', async () => {
    const { db, chamadas } = banco()

    await expect(reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA)).resolves.toBe(true)
    expect(chamadas).toEqual([
      {
        tabela: 'conversations',
        patch: { first_inbound_at: '2026-10-25T12:00:00.000Z' },
        eq: ['id', 'conv-1'],
        is: ['first_inbound_at', null],
        colunas: 'id',
      },
    ])
  })

  it('rajada: duas mensagens que contaram zero ao mesmo tempo — só UMA leva', async () => {
    const { db, chamadas } = banco()

    const resultados = await Promise.all([
      reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA),
      reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA),
    ])

    expect(resultados.filter(Boolean)).toHaveLength(1)
    expect(chamadas).toHaveLength(2)
  })

  it('a coluna já preenchida (outra requisição levou): não é a primeira', async () => {
    const { db } = banco({ jaLevada: true })

    await expect(reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA)).resolves.toBe(false)
  })

  it('o cliente já escreveu antes: nem tenta — a conversa antiga, de coluna nula, nunca é reivindicada', async () => {
    const { db, chamadas } = banco()

    await expect(
      reivindicarPrimeiraMensagem(db, 'conv-1', { count: 4, error: null }, AGORA),
    ).resolves.toBe(false)
    expect(chamadas).toEqual([])
  })

  it('contagem nula SEM erro vale zero, como sempre valeu', async () => {
    const { db } = banco()

    await expect(
      reivindicarPrimeiraMensagem(db, 'conv-1', { count: null, error: null }, AGORA),
    ).resolves.toBe(true)
  })

  it('a contagem falhou: falha FECHADA, sem tentar', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db, chamadas } = banco()

    await expect(
      reivindicarPrimeiraMensagem(db, 'conv-1', { count: null, error: { message: 'timeout' } }, AGORA),
    ).resolves.toBe(false)
    expect(chamadas).toEqual([])
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('contagem'), 'timeout')
    erro.mockRestore()
  })

  it('a reivindicação voltou erro (a coluna ainda não existe, por exemplo): falha FECHADA', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = banco({ erro: { message: 'column "first_inbound_at" does not exist' } })

    await expect(reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA)).resolves.toBe(false)
    expect(erro).toHaveBeenCalledTimes(1)
    erro.mockRestore()
  })

  it('a reivindicação LANÇOU: falha fechada, e não lança', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = banco({ lanca: true })

    await expect(reivindicarPrimeiraMensagem(db, 'conv-1', ZERO, AGORA)).resolves.toBe(false)
    expect(erro).toHaveBeenCalledWith(expect.stringContaining('lançou'), 'rede caiu')
    erro.mockRestore()
  })
})
