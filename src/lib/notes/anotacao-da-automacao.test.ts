import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  autorDaAnotacao,
  ehListaDeMarcados,
  escreverAnotacaoDaAutomacao,
  lerMarcados,
  MAX_TEXTO_DA_ANOTACAO,
  textoComMarcacoes,
} from './anotacao-da-automacao'

const CONTA = 'conta-1'
const ANA = '11111111-1111-4111-8111-111111111111'
const BIA = '22222222-2222-4222-8222-222222222222'
const CAIO = '33333333-3333-4333-8333-333333333333'

describe('peças puras', () => {
  it('lerMarcados: só ids, sem repetição, na ordem da configuração', () => {
    expect(lerMarcados([BIA, 'Ana', ANA, BIA, 7])).toEqual([BIA, ANA])
    expect(lerMarcados(undefined)).toEqual([])
    expect(lerMarcados(ANA)).toEqual([])
  })

  it('ehListaDeMarcados: a forma que a ativação aceita', () => {
    expect(ehListaDeMarcados([])).toBe(true)
    expect(ehListaDeMarcados([ANA, BIA])).toBe(true)
    expect(ehListaDeMarcados([ANA, 'Bia'])).toBe(false)
    expect(ehListaDeMarcados(ANA)).toBe(false)
  })

  it('as marcações vão no começo, como a equipe escreve', () => {
    expect(textoComMarcacoes('verificar cliente.', ['Ana Lima', 'Bia'])).toBe('@Ana Lima @Bia verificar cliente.')
    expect(textoComMarcacoes('verificar cliente.', [])).toBe('verificar cliente.')
  })

  it('a automação assina pelo nome', () => {
    expect(autorDaAnotacao(' Contato do Banco ')).toBe('Automação "Contato do Banco"')
    expect(autorDaAnotacao('')).toBe('Automação')
  })
})

interface Chamada {
  tabela: string
  insert?: unknown
  filtros: [string, string, unknown][]
}

/** Banco falso: devolve o que o cenário manda e registra o que foi pedido. */
function bancoFalso(cenario: {
  conversa?: { id: string; contact_id: string | null } | null
  erroConversa?: string
  perfis?: { user_id: string; full_name: string | null; email: string | null; suspenso_em: string | null }[]
  erroPerfis?: string
  erroNota?: string
  erroAviso?: string
}) {
  const chamadas: Chamada[] = []
  const db = {
    from(tabela: string) {
      const c: Chamada = { tabela, filtros: [] }
      chamadas.push(c)
      const resposta = () => {
        if (tabela === 'conversations')
          return cenario.erroConversa
            ? { data: null, error: { message: cenario.erroConversa } }
            : { data: cenario.conversa === undefined ? { id: 'conv-1', contact_id: 'ct-1' } : cenario.conversa, error: null }
        if (tabela === 'profiles')
          return cenario.erroPerfis
            ? { data: null, error: { message: cenario.erroPerfis } }
            : { data: cenario.perfis ?? [], error: null }
        if (tabela === 'cb_conversation_notes')
          return cenario.erroNota ? { data: null, error: { message: cenario.erroNota } } : { data: { id: 'nota-1' }, error: null }
        if (tabela === 'notifications')
          return { data: null, error: cenario.erroAviso ? { message: cenario.erroAviso } : null }
        return { data: null, error: null }
      }
      const b = {
        select: () => b,
        eq: (col: string, v: unknown) => (c.filtros.push(['eq', col, v]), b),
        in: (col: string, v: unknown) => (c.filtros.push(['in', col, v]), b),
        insert: (v: unknown) => ((c.insert = v), b),
        maybeSingle: async () => resposta(),
        single: async () => resposta(),
        then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, falha),
      }
      return b
    },
  }
  return { db: db as unknown as SupabaseClient, chamadas }
}

const entrada = (marcados: string[] = [ANA]) => ({
  accountId: CONTA,
  conversationId: 'conv-1',
  nomeDaAutomacao: 'Contato do Banco',
  texto: 'Contato bancário: verificar cliente.',
  marcados,
})

const PERFIS = [
  { user_id: ANA, full_name: 'Ana Lima ', email: 'ana@exemplo.test', suspenso_em: null },
  { user_id: BIA, full_name: '', email: 'bia@exemplo.test', suspenso_em: null },
  { user_id: CAIO, full_name: 'Caio', email: null, suspenso_em: '2026-10-01T00:00:00Z' },
]

describe('escreverAnotacaoDaAutomacao', () => {
  it('CRÍTICO: grava a anotação assinada pela automação, com o @Nome na frente, e avisa no sino', async () => {
    const { db, chamadas } = bancoFalso({ perfis: PERFIS })
    const r = await escreverAnotacaoDaAutomacao(db, entrada([ANA]))

    expect(r).toEqual({ notaId: 'nota-1', avisados: ['Ana Lima'], foraDaConta: 0, erroDoAviso: null })
    const nota = chamadas.find((c) => c.tabela === 'cb_conversation_notes')
    expect(nota?.insert).toEqual({
      account_id: CONTA,
      conversation_id: 'conv-1',
      contact_id: 'ct-1',
      author_user_id: null,
      autor_nome: 'Automação "Contato do Banco"',
      texto: '@Ana Lima Contato bancário: verificar cliente.',
      mencionados: [ANA],
    })
    const aviso = chamadas.find((c) => c.tabela === 'notifications')
    expect(aviso?.insert).toEqual([
      {
        account_id: CONTA,
        user_id: ANA,
        type: 'note_mention',
        conversation_id: 'conv-1',
        contact_id: 'ct-1',
        actor_user_id: null,
        title: 'Automação "Contato do Banco" mencionou você numa anotação',
        body: '@Ana Lima Contato bancário: verificar cliente.',
      },
    ])
  })

  it('a conversa e os marcados são lidos cercados pela CONTA', async () => {
    const { db, chamadas } = bancoFalso({ perfis: PERFIS })
    await escreverAnotacaoDaAutomacao(db, entrada([ANA]))
    expect(chamadas.find((c) => c.tabela === 'conversations')?.filtros).toContainEqual(['eq', 'account_id', CONTA])
    const perfis = chamadas.find((c) => c.tabela === 'profiles')
    expect(perfis?.filtros).toContainEqual(['eq', 'account_id', CONTA])
    expect(perfis?.filtros).toContainEqual(['in', 'user_id', [ANA]])
  })

  it('sem nome, o e-mail; a ordem dos @ é a da configuração', async () => {
    const { db, chamadas } = bancoFalso({ perfis: PERFIS })
    const r = await escreverAnotacaoDaAutomacao(db, entrada([BIA, ANA]))
    expect(r.avisados).toEqual(['bia@exemplo.test', 'Ana Lima'])
    const nota = chamadas.find((c) => c.tabela === 'cb_conversation_notes')?.insert as { texto: string }
    expect(nota.texto).toBe('@bia@exemplo.test @Ana Lima Contato bancário: verificar cliente.')
  })

  it('⚠️ quem saiu da conta ou está suspenso não é marcado nem avisado, e o resultado CONTA', async () => {
    const fora = '44444444-4444-4444-8444-444444444444'
    const { db, chamadas } = bancoFalso({ perfis: PERFIS })
    const r = await escreverAnotacaoDaAutomacao(db, entrada([ANA, CAIO, fora]))
    expect(r.foraDaConta).toBe(2)
    expect(r.avisados).toEqual(['Ana Lima'])
    const nota = chamadas.find((c) => c.tabela === 'cb_conversation_notes')?.insert as { mencionados: string[] }
    expect(nota.mencionados).toEqual([ANA])
    expect((chamadas.find((c) => c.tabela === 'notifications')?.insert as unknown[]).length).toBe(1)
  })

  it('sem marcados: grava sem ler perfis nem avisar', async () => {
    const { db, chamadas } = bancoFalso({})
    const r = await escreverAnotacaoDaAutomacao(db, entrada([]))
    expect(r).toEqual({ notaId: 'nota-1', avisados: [], foraDaConta: 0, erroDoAviso: null })
    expect(chamadas.map((c) => c.tabela)).toEqual(['conversations', 'cb_conversation_notes'])
  })

  it('o aviso que falha volta no resultado — a anotação já existe', async () => {
    const { db } = bancoFalso({ perfis: PERFIS, erroAviso: 'sino fora' })
    const r = await escreverAnotacaoDaAutomacao(db, entrada([ANA]))
    expect(r.notaId).toBe('nota-1')
    expect(r.erroDoAviso).toBe('sino fora')
  })

  it('⚠️ leitura que falha LANÇA antes de gravar qualquer coisa', async () => {
    const semConversa = bancoFalso({ erroConversa: 'rede' })
    await expect(escreverAnotacaoDaAutomacao(semConversa.db, entrada())).rejects.toThrow('leitura da conversa falhou')
    const semPerfis = bancoFalso({ erroPerfis: 'rede' })
    await expect(escreverAnotacaoDaAutomacao(semPerfis.db, entrada())).rejects.toThrow('leitura de quem marcar falhou')
    expect(semPerfis.chamadas.map((c) => c.tabela)).not.toContain('cb_conversation_notes')
  })

  it('conversa de outra conta (ou apagada): LANÇA', async () => {
    const { db } = bancoFalso({ conversa: null })
    await expect(escreverAnotacaoDaAutomacao(db, entrada())).rejects.toThrow('conversa não encontrada nesta conta')
  })

  it('texto que passa do teto com as marcações: LANÇA sem gravar', async () => {
    const { db, chamadas } = bancoFalso({ perfis: PERFIS })
    await expect(
      escreverAnotacaoDaAutomacao(db, { ...entrada([ANA]), texto: 'a'.repeat(MAX_TEXTO_DA_ANOTACAO) }),
    ).rejects.toThrow('passou de 4000 caracteres')
    expect(chamadas.map((c) => c.tabela)).not.toContain('cb_conversation_notes')
  })

  it('gravar que falha LANÇA e não avisa', async () => {
    const { db, chamadas } = bancoFalso({ perfis: PERFIS, erroNota: 'recusado' })
    await expect(escreverAnotacaoDaAutomacao(db, entrada())).rejects.toThrow('gravar falhou: recusado')
    expect(chamadas.map((c) => c.tabela)).not.toContain('notifications')
  })
})
