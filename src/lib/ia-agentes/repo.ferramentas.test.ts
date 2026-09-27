import { beforeEach, describe, expect, it, vi } from 'vitest'

// atualizarAgente / criarAgente com FERRAMENTAS (F4, D28): a conferência
// (`conferirFerramentas`, testada em `ferramentas.test.ts`) roda ANTES de
// qualquer escrita, e a recusa vira `ErroDoAgente` com o código e os ids —
// nada é gravado. Erro de leitura na conferência é `banco`, nunca "passou".

const updates: Record<string, unknown>[] = []
const inserts: Record<string, unknown>[] = []

vi.mock('@/lib/ia-chaves/repo', () => ({ lerEstado: vi.fn(async () => []) }))
vi.mock('./ferramentas', () => ({ conferirFerramentas: vi.fn() }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (linha: Record<string, unknown>) => {
        inserts.push(linha)
        return { select: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'parou aqui' } }) }) }
      },
      update: (campos: Record<string, unknown>) => {
        updates.push(campos)
        const cadeia: Record<string, unknown> = {}
        cadeia.eq = () => cadeia
        cadeia.is = () => cadeia
        cadeia.select = () => cadeia
        cadeia.maybeSingle = async () => ({ data: null, error: { code: 'XX000', message: 'parou aqui' } })
        return cadeia
      },
    }),
  }),
}))

import { conferirFerramentas } from './ferramentas'
import { atualizarAgente, criarAgente } from './repo'

const ETAPA = '44444444-4444-4444-8444-444444444444'

beforeEach(() => {
  updates.length = 0
  inserts.length = 0
  vi.mocked(conferirFerramentas).mockReset()
})

describe('as ferramentas são conferidas antes de gravar', () => {
  it('recusa: ErroDoAgente com o código e os ids, nada gravado', async () => {
    vi.mocked(conferirFerramentas).mockResolvedValue({ ok: false, codigo: 'etapa_de_resultado', itens: [ETAPA] })
    await expect(
      atualizarAgente('conta-1', 'user-1', 'ag-1', { ferramentas: { mover_etapa: { etapas: [ETAPA] } } }),
    ).rejects.toMatchObject({ codigo: 'etapa_de_resultado', itens: [ETAPA] })
    expect(updates).toHaveLength(0)
    expect(vi.mocked(conferirFerramentas).mock.calls[0].slice(1)).toEqual([
      'conta-1',
      { mover_etapa: { etapas: [ETAPA] } },
    ])
  })

  it('na criação também', async () => {
    vi.mocked(conferirFerramentas).mockResolvedValue({ ok: false, codigo: 'item_de_outra_conta', itens: [ETAPA] })
    await expect(
      criarAgente('conta-1', 'user-1', { nome: 'X', ferramentas: { etiquetar: { etiquetas: [ETAPA] } } }),
    ).rejects.toMatchObject({ codigo: 'item_de_outra_conta' })
    expect(inserts).toHaveLength(0)
  })

  it('a conferência que falha é `banco`, nunca "passou"', async () => {
    vi.mocked(conferirFerramentas).mockRejectedValue(new Error('timeout'))
    await expect(
      atualizarAgente('conta-1', 'user-1', 'ag-1', { ferramentas: { etiquetar: { etiquetas: [ETAPA] } } }),
    ).rejects.toMatchObject({ codigo: 'banco' })
    expect(updates).toHaveLength(0)
  })

  it('sem `ferramentas` na alteração, não confere nada', async () => {
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', { nome: 'Y' })).rejects.toMatchObject({ codigo: 'banco' })
    expect(conferirFerramentas).not.toHaveBeenCalled()
    expect(updates).toHaveLength(1)
  })
})
