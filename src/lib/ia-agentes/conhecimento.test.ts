import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// A base de conhecimento DO AGENTE (F3, D20). O que estes testes seguram:
//  - nada marcado = NENHUMA base, com UMA leitura e SEM a chave de
//    embeddings nem o provedor (a chave chega como função, chamada só aqui);
//  - a busca vai pelas funções NOVAS da 1052, sempre com o agente — nunca
//    pelas da 0903, cujo parâmetro nulo quer dizer "sem recorte";
//  - por sentido com a chave, completada por palavras; sem chave, só palavras;
//  - melhor esforço: erro vira menos trechos, nunca exceção.
// ============================================================

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { consultaDaUltimaMensagem, retrieveKnowledgeDoAgente } from './conhecimento'

interface Estado {
  documentos: Array<{ documento_id: string }>
  erroDosDocumentos: { message: string } | null
  semantico: unknown
  fts: unknown
  erroDoRpc: { message: string } | null
  rpcs: Array<{ nome: string; args: Record<string, unknown> }>
  filtros: Array<[string, unknown]>
}

function criarBanco() {
  const e: Estado = {
    documentos: [{ documento_id: 'doc-1' }],
    erroDosDocumentos: null,
    semantico: [],
    fts: [],
    erroDoRpc: null,
    rpcs: [],
    filtros: [],
  }
  const db = {
    from: (tabela: string) => {
      expect(tabela).toBe('cb_ia_agente_documentos')
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          e.filtros.push([c, v])
          return q
        },
        limit: async () => ({ data: e.erroDosDocumentos ? null : e.documentos, error: e.erroDosDocumentos }),
      }
      return q
    },
    rpc: async (nome: string, args: Record<string, unknown>) => {
      e.rpcs.push({ nome, args })
      if (e.erroDoRpc) return { data: null, error: e.erroDoRpc }
      return { data: nome.endsWith('semantico') ? e.semantico : e.fts, error: null }
    },
  }
  return { db: db as unknown as SupabaseClient, e }
}

const trecho = (id: string, documento_id = 'doc-1') => ({ id, documento_id, content: `texto ${id}`, score: 1 })

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_k: string, entradas: string[]) => entradas.map(() => [0.1, 0.2]))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('retrieveKnowledgeDoAgente', () => {
  it('agente SEM documento: [] com uma leitura, sem ler a chave nem chamar o provedor', async () => {
    const { db, e } = criarBanco()
    e.documentos = []
    const chave = vi.fn(async () => 'sk-x')
    expect(await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', chave, 'horário')).toEqual([])
    expect(chave).not.toHaveBeenCalled()
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(e.rpcs).toEqual([])
    // A pergunta é da CONTA e do AGENTE.
    expect(e.filtros).toEqual([
      ['account_id', 'conta-1'],
      ['ia_agente_id', 'ag-1'],
    ])
  })

  it('consulta vazia: nada, sem tocar no banco', async () => {
    const { db, e } = criarBanco()
    expect(await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => null, '   ')).toEqual([])
    expect(e.filtros).toEqual([])
  })

  it('erro ao ler os documentos do agente: [] (nunca a base inteira)', async () => {
    const { db, e } = criarBanco()
    e.erroDosDocumentos = { message: 'timeout' }
    expect(await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => 'sk-x', 'q')).toEqual([])
    expect(e.rpcs).toEqual([])
  })

  it('com chave: por sentido primeiro, completada por palavras, sem repetir, pelas funções NOVAS', async () => {
    const { db, e } = criarBanco()
    e.semantico = [trecho('c1'), trecho('c2', 'doc-2')]
    e.fts = [trecho('c2', 'doc-2'), trecho('c3')]
    const r = await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => 'sk-x', 'boleto', 3)
    expect(r).toEqual([
      { id: 'c1', documentoId: 'doc-1', content: 'texto c1' },
      { id: 'c2', documentoId: 'doc-2', content: 'texto c2' },
      { id: 'c3', documentoId: 'doc-1', content: 'texto c3' },
    ])
    expect(e.rpcs.map((r) => r.nome)).toEqual(['cb_ia_buscar_conhecimento_semantico', 'cb_ia_buscar_conhecimento_fts'])
    expect(e.rpcs[0].args).toEqual({
      p_account_id: 'conta-1',
      p_ia_agente_id: 'ag-1',
      p_query_embedding: '[0.1,0.2]',
      p_match_count: 3,
    })
    expect(e.rpcs[1].args).toMatchObject({ p_account_id: 'conta-1', p_ia_agente_id: 'ag-1', p_query: 'boleto' })
  })

  it('por sentido já encheu: não completa por palavras', async () => {
    const { db, e } = criarBanco()
    e.semantico = [trecho('c1'), trecho('c2')]
    await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => 'sk-x', 'q', 2)
    expect(e.rpcs.map((r) => r.nome)).toEqual(['cb_ia_buscar_conhecimento_semantico'])
  })

  it('sem chave de embeddings: só por palavras', async () => {
    const { db, e } = criarBanco()
    e.fts = [trecho('c3')]
    const r = await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => null, 'q')
    expect(r.map((t) => t.id)).toEqual(['c3'])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(e.rpcs.map((r) => r.nome)).toEqual(['cb_ia_buscar_conhecimento_fts'])
  })

  it('a leitura da chave que falha, ou o embedding que falha, cai para palavras', async () => {
    const um = criarBanco()
    um.e.fts = [trecho('c3')]
    const r1 = await retrieveKnowledgeDoAgente(um.db, 'conta-1', 'ag-1', async () => {
      throw new Error('cb_ia_chaves fora do ar')
    }, 'q')
    expect(r1.map((t) => t.id)).toEqual(['c3'])

    const dois = criarBanco()
    dois.e.fts = [trecho('c3')]
    h.embedTexts.mockRejectedValueOnce(new Error('401'))
    const r2 = await retrieveKnowledgeDoAgente(dois.db, 'conta-1', 'ag-1', async () => 'sk-x', 'q')
    expect(r2.map((t) => t.id)).toEqual(['c3'])
  })

  it('erro das funções de busca: [] sem lançar; linha fora da forma é ignorada', async () => {
    const { db, e } = criarBanco()
    e.erroDoRpc = { message: 'function does not exist' }
    expect(await retrieveKnowledgeDoAgente(db, 'conta-1', 'ag-1', async () => 'sk-x', 'q')).toEqual([])

    const outro = criarBanco()
    outro.e.fts = [{ id: 'c1' }, trecho('c2'), null]
    const r = await retrieveKnowledgeDoAgente(outro.db, 'conta-1', 'ag-1', async () => null, 'q')
    expect(r.map((t) => t.id)).toEqual(['c2'])
  })
})

describe('consultaDaUltimaMensagem', () => {
  it('a última mensagem do cliente, sem o rótulo da mídia', () => {
    expect(
      consultaDaUltimaMensagem([
        { role: 'user', content: 'primeira' },
        { role: 'assistant', content: 'resposta' },
        { role: 'user', content: '[audio message, transcribed] qual o horário?' },
      ]),
    ).toBe('qual o horário?')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[document: extrato.pdf] segue' }])).toBe('segue')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: 'texto [com colchete]' }])).toBe('texto [com colchete]')
    // O colchete que o CLIENTE digitou fica: não é rótulo (Codex, #312).
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[reembolso]' }])).toBe('[reembolso]')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[preço] quais as condições?' }])).toBe('[preço] quais as condições?')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[image] olha isso' }])).toBe('olha isso')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[document] segue' }])).toBe('segue')
  })

  it('a LEITURA de uma imagem ou PDF entra na consulta sem o invólucro; a recusa sai com o rótulo', () => {
    expect(
      consultaDaUltimaMensagem([{ role: 'user', content: '[image] meu boleto\n(content: Boleto do Banco X, vencimento 10/10)' }]),
    ).toBe('meu boleto\nBoleto do Banco X, vencimento 10/10')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[image]\n(content: Print: "qual o prazo?")' }])).toBe(
      'Print: "qual o prazo?"',
    )
    expect(
      consultaDaUltimaMensagem([{ role: 'user', content: '[image — could not be read: arquivo grande demais para ler] segue' }]),
    ).toBe('segue')
    expect(
      consultaDaUltimaMensagem([
        { role: 'user', content: '[document: x.docx — could not be read: tipo de arquivo que o agente não lê]' },
      ]),
    ).toBe('')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[document — could not be read: x] oi' }])).toBe('oi')
    // A ainda não lida sai com o rótulo, também.
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[image — not read yet] meu boleto' }])).toBe('meu boleto')
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[document: x.pdf — not read yet]' }])).toBe('')
  })

  it('áudio sem transcrição = consulta vazia (nada a buscar)', () => {
    expect(consultaDaUltimaMensagem([{ role: 'user', content: '[audio message, not transcribed]' }])).toBe('')
  })
})
