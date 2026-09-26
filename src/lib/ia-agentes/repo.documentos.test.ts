import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Os DOCUMENTOS da base que o agente usa (F3, D20, `cb_ia_agente_documentos`):
// a tela manda a lista inteira; o repositório confere que o agente é desta
// conta e não está arquivado, que todo documento é DESTA conta (400
// `documento_invalido` — a FK composta seria a última palavra, com erro cru),
// insere os novos (os que já estavam não se tocam) e só DEPOIS apaga os que
// saíram. Toda consulta leva a conta (cliente de serviço).
// ============================================================

type Chamada = {
  tabela: string
  op: 'select' | 'upsert' | 'delete'
  filtros: Array<[string, ...unknown[]]>
  payload?: unknown
  opcoes?: unknown
}

const chamadas: Chamada[] = []
let responder: (c: Chamada) => { data: unknown; error: unknown }

function consulta(tabela: string, op: Chamada['op'], payload?: unknown, opcoes?: unknown) {
  const c: Chamada = { tabela, op, filtros: [], payload, opcoes }
  chamadas.push(c)
  const q: Record<string, unknown> = {}
  for (const m of ['eq', 'is', 'in', 'not', 'order', 'select', 'limit']) {
    q[m] = (...args: unknown[]) => {
      c.filtros.push([m, ...args])
      return q
    }
  }
  q.maybeSingle = async () => responder(c)
  q.then = (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) => Promise.resolve(responder(c)).then(ok, falha)
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
      upsert: (payload: unknown, opcoes: unknown) => consulta(tabela, 'upsert', payload, opcoes),
      delete: () => consulta(tabela, 'delete'),
    }),
  }),
}))

import { gravarDocumentosDoAgente, lerDocumentosDoAgente } from './repo'

const CONTA = 'conta-1'
const AG = 'ag-1'

let agente: Record<string, unknown> | null
let documentosDaConta: string[]
let marcados: string[]
let erroDoUpsert: { code: string; message: string } | null

function linhaDoAgente(p: Record<string, unknown> = {}) {
  return {
    id: AG, account_id: CONTA, nome: 'Triagem', descricao: '', instrucoes: '', regras: [], provedor: 'gemini',
    modelo: 'm', ativo: true, conexoes: [], horario: null, teto_respostas: 5, pode_passar_para: [],
    transferir_para: null, ativado_em: null, arquivado_em: null, created_at: '', updated_at: '', ...p,
  }
}

const filtro = (c: Chamada, m: string, col?: string) => c.filtros.find((f) => f[0] === m && (col === undefined || f[1] === col))

beforeEach(() => {
  chamadas.length = 0
  agente = linhaDoAgente()
  documentosDaConta = ['d1', 'd2', 'd3']
  marcados = ['d1']
  erroDoUpsert = null
  responder = (c) => {
    if (c.tabela === 'cb_ia_agentes') return { data: agente, error: null }
    if (c.tabela === 'ai_knowledge_documents') {
      const pedidos = (filtro(c, 'in', 'id')?.[2] as string[]) ?? []
      return { data: pedidos.filter((d) => documentosDaConta.includes(d)).map((id) => ({ id })), error: null }
    }
    if (c.tabela === 'cb_ia_agente_documentos') {
      if (c.op === 'upsert') {
        if (erroDoUpsert) return { data: null, error: erroDoUpsert }
        for (const l of c.payload as { documento_id: string }[]) if (!marcados.includes(l.documento_id)) marcados.push(l.documento_id)
        return { data: null, error: null }
      }
      if (c.op === 'delete') {
        const fica = filtro(c, 'not', 'documento_id')?.[3] as string | undefined
        marcados = fica ? marcados.filter((d) => fica.includes(d)) : []
        return { data: null, error: null }
      }
      return { data: [...marcados].sort().map((documento_id) => ({ documento_id })), error: null }
    }
    return { data: null, error: null }
  }
})

describe('lerDocumentosDoAgente', () => {
  it('os documentos marcados, da conta e do agente', async () => {
    expect(await lerDocumentosDoAgente(CONTA, AG)).toEqual(['d1'])
    const c = chamadas.find((x) => x.tabela === 'cb_ia_agente_documentos')!
    expect(filtro(c, 'eq', 'account_id')).toEqual(['eq', 'account_id', CONTA])
    expect(filtro(c, 'eq', 'ia_agente_id')).toEqual(['eq', 'ia_agente_id', AG])
  })

  it('erro de leitura lança (nunca "nenhum documento")', async () => {
    responder = () => ({ data: null, error: { message: 'timeout' } })
    await expect(lerDocumentosDoAgente(CONTA, AG)).rejects.toMatchObject({ codigo: 'banco' })
  })
})

describe('gravarDocumentosDoAgente', () => {
  it('insere os novos ANTES de apagar os que saíram, e devolve a lista relida', async () => {
    expect(await gravarDocumentosDoAgente(CONTA, AG, ['d2', 'd3'])).toEqual(['d2', 'd3'])
    const ops = chamadas.filter((c) => c.tabela === 'cb_ia_agente_documentos').map((c) => c.op)
    expect(ops).toEqual(['upsert', 'delete', 'select'])
    const upsert = chamadas.find((c) => c.op === 'upsert')!
    expect(upsert.payload).toEqual([
      { account_id: CONTA, ia_agente_id: AG, documento_id: 'd2' },
      { account_id: CONTA, ia_agente_id: AG, documento_id: 'd3' },
    ])
    expect(upsert.opcoes).toEqual({ onConflict: 'ia_agente_id,documento_id', ignoreDuplicates: true })
    const apagar = chamadas.find((c) => c.op === 'delete')!
    expect(filtro(apagar, 'eq', 'account_id')).toEqual(['eq', 'account_id', CONTA])
    expect(filtro(apagar, 'not', 'documento_id')).toEqual(['not', 'documento_id', 'in', '(d2,d3)'])
  })

  it('a conferência dos documentos é pela CONTA', async () => {
    await gravarDocumentosDoAgente(CONTA, AG, ['d2'])
    const c = chamadas.find((x) => x.tabela === 'ai_knowledge_documents')!
    expect(filtro(c, 'eq', 'account_id')).toEqual(['eq', 'account_id', CONTA])
  })

  it('documento de OUTRA conta: documento_invalido, nada gravado', async () => {
    await expect(gravarDocumentosDoAgente(CONTA, AG, ['d2', 'de-outra'])).rejects.toMatchObject({
      codigo: 'documento_invalido',
    })
    expect(chamadas.some((c) => c.op === 'upsert' || c.op === 'delete')).toBe(false)
    expect(marcados).toEqual(['d1'])
  })

  it('documento apagado entre a conferência e o insert (23503): documento_invalido, sem apagar nada', async () => {
    erroDoUpsert = { code: '23503', message: 'fk' }
    await expect(gravarDocumentosDoAgente(CONTA, AG, ['d2'])).rejects.toMatchObject({ codigo: 'documento_invalido' })
    expect(chamadas.some((c) => c.op === 'delete')).toBe(false)
  })

  it('lista vazia = nenhuma base: apaga tudo, sem conferir nem inserir', async () => {
    expect(await gravarDocumentosDoAgente(CONTA, AG, [])).toEqual([])
    expect(chamadas.some((c) => c.tabela === 'ai_knowledge_documents' || c.op === 'upsert')).toBe(false)
    const apagar = chamadas.find((c) => c.op === 'delete')!
    expect(filtro(apagar, 'not')).toBeUndefined()
  })

  it('agente arquivado ou de outra conta: nao_encontrado, nada gravado', async () => {
    agente = linhaDoAgente({ arquivado_em: '2026-09-01T00:00:00Z' })
    await expect(gravarDocumentosDoAgente(CONTA, AG, ['d2'])).rejects.toMatchObject({ codigo: 'nao_encontrado' })
    agente = null
    await expect(gravarDocumentosDoAgente(CONTA, AG, ['d2'])).rejects.toMatchObject({ codigo: 'nao_encontrado' })
    expect(chamadas.some((c) => c.op === 'upsert' || c.op === 'delete')).toBe(false)
  })
})
