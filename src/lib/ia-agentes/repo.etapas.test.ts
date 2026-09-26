import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// As ETAPAS em que o agente atua (D24, `cb_ia_agente_etapas`): a tela manda a
// lista inteira; o repositório confere que cada etapa é de um funil DESTA
// conta, recusa etapa de OUTRO agente (com o nome dele), apaga as que saíram
// e insere só as novas — as que ficam mantêm o `desde` (D27).
// ============================================================

type Chamada = {
  tabela: string
  op: 'select' | 'insert' | 'update' | 'delete'
  filtros: Array<[string, ...unknown[]]>
  payload?: unknown
}

const chamadas: Chamada[] = []
// Resposta por (tabela, operação); o teste troca o que precisar.
let responder: (c: Chamada) => { data: unknown; error: unknown }

function consulta(tabela: string, op: Chamada['op'], payload?: unknown) {
  const c: Chamada = { tabela, op, filtros: [], payload }
  chamadas.push(c)
  const q: Record<string, unknown> = {}
  for (const m of ['eq', 'is', 'in', 'not', 'order', 'select', 'limit']) {
    q[m] = (...args: unknown[]) => {
      c.filtros.push([m, ...args])
      return q
    }
  }
  q.maybeSingle = async () => responder(c)
  q.single = async () => responder(c)
  q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
    Promise.resolve(responder(c)).then(ok, falha)
  return q
}

vi.mock('@/lib/ia-chaves/repo', () => ({ lerEstado: vi.fn(async () => []) }))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      select: (...args: unknown[]) => {
        const q = consulta(tabela, 'select') as { select: (...a: unknown[]) => unknown }
        return q.select(...args)
      },
      insert: (payload: unknown) => consulta(tabela, 'insert', payload),
      update: (payload: unknown) => consulta(tabela, 'update', payload),
      delete: () => consulta(tabela, 'delete'),
    }),
  }),
}))

import { atualizarAgente } from './repo'

const CONTA = 'conta-1'
const AG = 'ag-1'

function linhaDoAgente(p: Record<string, unknown> = {}) {
  return {
    id: AG, account_id: CONTA, nome: 'Triagem', descricao: '', instrucoes: '', regras: [], provedor: 'gemini',
    modelo: 'm', ativo: true, conexoes: [], horario: null, teto_respostas: 5, pode_passar_para: [],
    transferir_para: null, ativado_em: null, arquivado_em: null, created_at: '', updated_at: '', ...p,
  }
}

// O estado do "banco" de cada cenário.
let agente: Record<string, unknown> | null
let etapasDaConta: string[]
let marcadas: { stage_id: string; ia_agente_id: string }[]
let outros: Record<string, Record<string, unknown>>
let erroDoInsert: { code: string; message: string } | null

function filtro(c: Chamada, m: string, col?: string) {
  return c.filtros.find((f) => f[0] === m && (col === undefined || f[1] === col))
}

beforeEach(() => {
  chamadas.length = 0
  agente = linhaDoAgente()
  etapasDaConta = ['e1', 'e2', 'e3']
  marcadas = [{ stage_id: 'e1', ia_agente_id: AG }]
  outros = { 'ag-2': linhaDoAgente({ id: 'ag-2', nome: 'Cobrança' }) }
  erroDoInsert = null
  responder = (c) => {
    if (c.tabela === 'cb_ia_agentes' && c.op === 'select') {
      const id = filtro(c, 'eq', 'id')?.[2] as string
      return { data: id === AG ? agente : (outros[id] ?? null), error: null }
    }
    if (c.tabela === 'cb_ia_agentes' && c.op === 'update') return { data: agente, error: null }
    if (c.tabela === 'pipeline_stages') {
      const ids = (filtro(c, 'in', 'id')?.[2] as string[]) ?? []
      return { data: ids.filter((i) => etapasDaConta.includes(i)).map((id) => ({ id })), error: null }
    }
    if (c.tabela === 'cb_ia_agente_etapas' && c.op === 'select') {
      const ids = (filtro(c, 'in', 'stage_id')?.[2] as string[]) ?? []
      return { data: marcadas.filter((m) => ids.includes(m.stage_id)), error: null }
    }
    if (c.tabela === 'cb_ia_agente_etapas' && c.op === 'insert') return { data: null, error: erroDoInsert }
    return { data: null, error: null }
  }
})

const escritas = () => chamadas.filter((c) => c.op !== 'select')

describe('atualizarAgente — etapas (D24)', () => {
  it('apaga as que saíram e insere SÓ as novas; a que fica não é regravada (mantém o desde)', async () => {
    await atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e1', 'e3'] })
    const apagar = chamadas.find((c) => c.tabela === 'cb_ia_agente_etapas' && c.op === 'delete')!
    expect(filtro(apagar, 'eq', 'account_id')?.[2]).toBe(CONTA)
    expect(filtro(apagar, 'eq', 'ia_agente_id')?.[2]).toBe(AG)
    expect(filtro(apagar, 'not')).toEqual(['not', 'stage_id', 'in', '(e1,e3)'])
    const inserir = chamadas.find((c) => c.tabela === 'cb_ia_agente_etapas' && c.op === 'insert')!
    expect(inserir.payload).toEqual([{ stage_id: 'e3', account_id: CONTA, ia_agente_id: AG }])
  })

  it('a etapa é conferida contra os funis DA CONTA (a conta vem do funil)', async () => {
    await atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e1'] })
    const etapas = chamadas.find((c) => c.tabela === 'pipeline_stages')!
    expect(filtro(etapas, 'eq', 'pipelines.account_id')?.[2]).toBe(CONTA)
  })

  it('lista vazia tira o agente de todas as etapas', async () => {
    await atualizarAgente(CONTA, 'user-1', AG, { etapas: [] })
    const apagar = chamadas.find((c) => c.tabela === 'cb_ia_agente_etapas' && c.op === 'delete')!
    expect(filtro(apagar, 'not')).toBeUndefined()
    expect(chamadas.some((c) => c.op === 'insert')).toBe(false)
  })

  it('etapa que não é de funil desta conta: recusa, nada gravado', async () => {
    await expect(atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e1', 'de-fora'] })).rejects.toMatchObject({
      codigo: 'etapa_de_outra_conta',
    })
    expect(escritas()).toHaveLength(0)
  })

  it('⚠️ etapa de OUTRO agente: etapa_ocupada com o nome dele, nada gravado', async () => {
    marcadas.push({ stage_id: 'e2', ia_agente_id: 'ag-2' })
    await expect(atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e1', 'e2'] })).rejects.toMatchObject({
      codigo: 'etapa_ocupada',
      outroAgente: 'Cobrança',
    })
    expect(escritas()).toHaveLength(0)
  })

  it('agente ARQUIVADO não volta a ser dono de etapa', async () => {
    agente = linhaDoAgente({ arquivado_em: '2026-09-26T00:00:00Z' })
    await expect(atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e2'] })).rejects.toMatchObject({
      codigo: 'nao_encontrado',
    })
    expect(escritas()).toHaveLength(0)
  })

  it('a corrida (outro agente marcou entre a conferência e o INSERT) vira etapa_ocupada — e NADA mudou (Codex, #309)', async () => {
    erroDoInsert = { code: '23505', message: 'duplicate key' }
    await expect(
      atualizarAgente(CONTA, 'user-1', AG, { etapas: ['e2'], nome: 'Nome novo' }),
    ).rejects.toMatchObject({ codigo: 'etapa_ocupada' })
    // O INSERT vem ANTES de tirar as que saíram e antes de gravar o agente.
    expect(chamadas.some((c) => c.op === 'delete')).toBe(false)
    expect(chamadas.some((c) => c.tabela === 'cb_ia_agentes' && c.op === 'update')).toBe(false)
  })

  it('sem `etapas` no corpo, a tabela de etapas nem é tocada', async () => {
    await atualizarAgente(CONTA, 'user-1', AG, { nome: 'Outro nome' })
    expect(chamadas.some((c) => c.tabela === 'cb_ia_agente_etapas' || c.tabela === 'pipeline_stages')).toBe(false)
  })
})
