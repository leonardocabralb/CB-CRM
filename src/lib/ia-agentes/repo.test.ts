import { beforeEach, describe, expect, it, vi } from 'vitest'

// criarAgente / atualizarAgente — o provedor ESCOLHIDO precisa de uma chave
// que sirva ao CHAT. A chave da OpenAI que nasceu SÓ da base (1047) pode ser
// restrita aos embeddings: o agente nasceria mudo (Codex, #295).

let estado: { provedor: string; existe: boolean; soDaBase: boolean }[] = []
const inserts: Record<string, unknown>[] = []
const updates: Record<string, unknown>[] = []
// O agente guardado, lido por `obterAgente` ao LIGAR sem trocar o provedor.
let guardado: Record<string, unknown> | null = null

vi.mock('@/lib/ia-chaves/repo', () => ({ lerEstado: vi.fn(async () => estado) }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const leitura: Record<string, unknown> = {}
      leitura.eq = () => leitura
      leitura.maybeSingle = async () => ({ data: guardado, error: null })
      return {
        insert: (linha: Record<string, unknown>) => {
          inserts.push(linha)
          return { select: () => ({ single: async () => ({ data: null, error: { code: 'XX000', message: 'parou aqui' } }) }) }
        },
        select: () => leitura,
        update: (campos: Record<string, unknown>) => {
          updates.push(campos)
          const cadeia: Record<string, unknown> = {}
          cadeia.eq = () => cadeia
          cadeia.is = () => cadeia
          cadeia.select = () => cadeia
          cadeia.maybeSingle = async () => ({ data: null, error: { code: 'XX000', message: 'parou aqui' } })
          return cadeia
        },
      }
    },
  }),
}))

import { lerLinhaDoAgente } from './agente'
import { atualizarAgente, conferirRascunho, criarAgente } from './repo'

beforeEach(() => {
  inserts.length = 0
  updates.length = 0
  guardado = null
  estado = [
    { provedor: 'gemini', existe: true, soDaBase: false },
    { provedor: 'openai', existe: true, soDaBase: true },
    { provedor: 'anthropic', existe: false, soDaBase: false },
  ]
})

describe('criarAgente — a chave do provedor tem de servir ao chat', () => {
  it('OpenAI só da base: recusa com código próprio, nada gravado', async () => {
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'openai' } as never)).rejects.toMatchObject({
      codigo: 'provedor_so_da_base',
    })
    expect(inserts).toHaveLength(0)
  })

  it('provedor sem chave: provedor_sem_chave', async () => {
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'anthropic' } as never)).rejects.toMatchObject({
      codigo: 'provedor_sem_chave',
    })
  })

  it('OpenAI com chave de chat (não só da base): passa da conferência', async () => {
    estado[1] = { provedor: 'openai', existe: true, soDaBase: false }
    await expect(criarAgente('conta-1', 'user-1', { nome: 'X', provedor: 'openai' } as never)).rejects.toMatchObject({
      codigo: 'banco',
    })
    expect(inserts).toHaveLength(1)
  })
})

describe('atualizarAgente — LIGAR confere a chave do provedor guardado (Codex, #295)', () => {
  const linha = (provedor: string) => ({
    id: 'ag-1', account_id: 'conta-1', nome: 'X', descricao: null, instrucoes: '', regras: [], provedor,
    modelo: 'm', ativo: false, conexoes: [], horario: null, teto_respostas: 5, pode_passar_para: [],
    transferir_para: null, arquivado_em: null, created_at: '2026-09-26', updated_at: '2026-09-26',
  })

  it('só `{ ativo: true }` com a chave do provedor apagada: recusa, nada gravado', async () => {
    guardado = linha('anthropic')
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', { ativo: true })).rejects.toMatchObject({
      codigo: 'provedor_sem_chave',
    })
    expect(updates).toHaveLength(0)
  })

  it('só `{ ativo: true }` com a chave da OpenAI só da base: recusa', async () => {
    guardado = linha('openai')
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', { ativo: true })).rejects.toMatchObject({
      codigo: 'provedor_so_da_base',
    })
  })

  it('ligar com chave de chat: passa da conferência e grava', async () => {
    guardado = linha('gemini')
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', { ativo: true })).rejects.toMatchObject({ codigo: 'banco' })
    expect(updates).toHaveLength(1)
    expect(updates[0]).not.toHaveProperty('provedor')
  })

  it('desligar não confere chave nenhuma', async () => {
    guardado = linha('anthropic')
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', { ativo: false })).rejects.toMatchObject({ codigo: 'banco' })
    expect(updates).toHaveLength(1)
  })
})

describe('conferirRascunho — o rascunho do Playground conferido COMO o salvar (DC4, 26/10/2026)', () => {
  const linha = (provedor: string) => ({
    id: 'ag-1', account_id: 'conta-1', nome: 'X', descricao: null, instrucoes: '', regras: [], provedor,
    modelo: 'm', ativo: false, conexoes: [], horario: null, teto_respostas: 5, pode_passar_para: [],
    transferir_para: null, arquivado_em: null, created_at: '2026-09-26', updated_at: '2026-09-26',
  })
  const salvo = (provedor: string) => {
    const a = lerLinhaDoAgente(linha(provedor))
    if (!a) throw new Error('fixture')
    return a
  }

  it('trocar para provedor sem chave: o MESMO código do salvar, nada gravado', async () => {
    guardado = linha('gemini')
    const rascunho = { provedor: 'anthropic', modelo: 'claude-haiku-5-5' } as const
    await expect(atualizarAgente('conta-1', 'user-1', 'ag-1', rascunho)).rejects.toMatchObject({ codigo: 'provedor_sem_chave' })
    updates.length = 0
    await expect(conferirRascunho('conta-1', salvo('gemini'), rascunho)).rejects.toMatchObject({ codigo: 'provedor_sem_chave' })
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })

  it('OpenAI só da base: provedor_so_da_base, como no salvar', async () => {
    await expect(conferirRascunho('conta-1', salvo('gemini'), { provedor: 'openai', modelo: 'gpt-x' })).rejects.toMatchObject({
      codigo: 'provedor_so_da_base',
    })
  })

  it('o rascunho que LIGA confere a chave do provedor SALVO (como o salvar)', async () => {
    await expect(conferirRascunho('conta-1', salvo('anthropic'), { ativo: true })).rejects.toMatchObject({
      codigo: 'provedor_sem_chave',
    })
    await expect(conferirRascunho('conta-1', salvo('gemini'), { ativo: true })).resolves.toBeUndefined()
  })

  it('rascunho que passa: nada gravado', async () => {
    await expect(conferirRascunho('conta-1', salvo('gemini'), { instrucoes: 'Nova.', ativo: false })).resolves.toBeUndefined()
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(0)
  })
})
