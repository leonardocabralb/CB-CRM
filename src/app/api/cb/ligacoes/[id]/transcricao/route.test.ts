import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A rota do "Ver transcrição" da faixa (4d). Dublês: a sessão (o
// `requireRole` lançando os erros de verdade, com o cliente da SESSÃO que
// confere a conversa), o service role (um marcador) e `lerTranscricao` (o
// que a tabela fechada devolveria). Dados fictícios.
// ============================================================

const estado = vi.hoisted(() => ({
  recusa: null as null | 'sem_sessao' | 'sem_conta',
  papel: null as string | null,
  leitura: null as unknown,
  chamadas: [] as unknown[][],
  conversa: { id: 'conversa-1' } as { id: string } | null,
  erroDaConversa: null as null | { message: string },
  filtros: [] as unknown[][],
}))

const ADMIN = vi.hoisted(() => ({ cliente: 'service role' }))

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/account')>()
  // O cliente da SESSÃO: só a conferência da conversa passa por ele (RLS).
  const sessao = {
    from: (tabela: string) => {
      estado.filtros.push(['from', tabela])
      const consulta = {
        select: (colunas: string) => {
          estado.filtros.push(['select', colunas])
          return consulta
        },
        eq: (coluna: string, valor: unknown) => {
          estado.filtros.push(['eq', coluna, valor])
          return consulta
        },
        maybeSingle: async () => ({
          data: estado.erroDaConversa ? null : estado.conversa,
          error: estado.erroDaConversa,
        }),
      }
      return consulta
    },
  }
  return {
    ...real,
    requireRole: async (min: string) => {
      estado.papel = min
      if (estado.recusa === 'sem_sessao') throw new real.UnauthorizedError()
      if (estado.recusa === 'sem_conta') throw new real.ForbiddenError('Profile is not linked to an account')
      return {
        supabase: sessao,
        userId: 'usuario-1',
        accountId: 'conta-1',
        role: 'viewer',
        account: { id: 'conta-1', name: 'Conta' },
      }
    },
  }
})

vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ADMIN }))

vi.mock('@/lib/whatsapp/ligacoes/dialogos-gravados', () => ({
  lerTranscricao: async (...args: unknown[]) => {
    estado.chamadas.push(args)
    return estado.leitura
  },
}))

import { GET } from './route'

const ID = '7d3c2b1a-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
const pedir = (id = ID) =>
  GET(new Request(`http://localhost/api/cb/ligacoes/${id}/transcricao`), { params: Promise.resolve({ id }) })

const TRECHOS = [
  { quem: 'atendente', inicio: 0.4, texto: 'Bom dia, aqui é do escritório.' },
  { quem: 'cliente', inicio: 3.1, texto: 'Bom dia! Queria saber do meu processo.' },
]
const RESUMO = 'O cliente pediu notícias do processo; o atendente ficou de retornar na sexta.'

beforeEach(() => {
  estado.recusa = null
  estado.papel = null
  estado.leitura = { conversationId: 'conversa-1', trechos: TRECHOS, resumo: RESUMO }
  estado.chamadas = []
  estado.conversa = { id: 'conversa-1' }
  estado.erroDaConversa = null
  estado.filtros = []
})

describe('GET /api/cb/ligacoes/[id]/transcricao', () => {
  it('200 com os trechos e o resumo, para quem vê a conversa, sem cache', async () => {
    const r = await pedir()
    expect(r.status).toBe(200)
    // Só o diálogo: a conversa da ligação não sai.
    expect(await r.json()).toEqual({ trechos: TRECHOS, resumo: RESUMO })
    expect(r.headers.get('cache-control')).toBe('private, no-store')
    // A régua do ▶: lê quem vê a conversa (viewer+).
    expect(estado.papel).toBe('viewer')
    // A tabela é fechada: service role, cercado pela conta do membro.
    expect(estado.chamadas).toEqual([[ADMIN, 'conta-1', ID]])
    // A conversa é conferida pelo cliente da SESSÃO (RLS), na conta.
    expect(estado.filtros).toEqual([
      ['from', 'conversations'],
      ['select', 'id'],
      ['eq', 'id', 'conversa-1'],
      ['eq', 'account_id', 'conta-1'],
    ])
  })

  it('a gravação sem fala é 200 com a lista vazia, nunca 404', async () => {
    estado.leitura = { conversationId: 'conversa-1', trechos: [], resumo: null }
    const r = await pedir()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ trechos: [], resumo: null })
  })

  it('404 sem transcrição (não existe, não está pronta ou expirou), sem consultar a conversa', async () => {
    estado.leitura = null
    const r = await pedir()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'nao_encontrada' })
    expect(estado.filtros).toEqual([])
  })

  it('404 quando a ligação ficou sem conversa', async () => {
    estado.leitura = { conversationId: null, trechos: TRECHOS, resumo: RESUMO }
    const r = await pedir()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'nao_encontrada' })
    expect(estado.filtros).toEqual([])
  })

  it('⚠️ quem não vê a conversa recebe o MESMO 404 de "sem transcrição" (não revela que existe)', async () => {
    estado.conversa = null
    const r = await pedir()
    expect(r.status).toBe(404)
    expect(await r.json()).toEqual({ error: 'nao_encontrada' })
  })

  it('⚠️ leitura que falha é 500, nunca 404 (a tela afirmaria "sem transcrição")', async () => {
    estado.leitura = 'falhou'
    let r = await pedir()
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'falhou' })
    expect(estado.filtros).toEqual([])

    // A conferência da conversa que falha também é 500.
    estado.leitura = { conversationId: 'conversa-1', trechos: TRECHOS, resumo: RESUMO }
    estado.erroDaConversa = { message: 'o banco não respondeu' }
    r = await pedir()
    expect(r.status).toBe(500)
    expect(await r.json()).toEqual({ error: 'falhou' })
  })

  it('sem sessão é 401 e sem conta é 403, sem ler nada', async () => {
    estado.recusa = 'sem_sessao'
    expect((await pedir()).status).toBe(401)
    estado.recusa = 'sem_conta'
    expect((await pedir()).status).toBe(403)
    expect(estado.chamadas).toEqual([])
    expect(estado.filtros).toEqual([])
  })

  it('id que não é o de uma ligação (o `call_id` `crm:…`, um caminho) é 400, sem ler nada', async () => {
    for (const id of ['crm:7d3c2b1a-5e4f-4a3b-9c2d-1e0f9a8b7c6d', '..%2Fgravacao', 'abc']) {
      const r = await pedir(id)
      expect(r.status).toBe(400)
      expect(await r.json()).toEqual({ error: 'ligacao_invalida' })
    }
    expect(estado.chamadas).toEqual([])
  })
})
