import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// A rota que diz ao botão "Ligar" quais conexões têm computador de ligações
// (4c). Dados fictícios.
// ============================================================

const estado = vi.hoisted(() => ({
  linhas: [] as Record<string, unknown>[],
  erro: null as null | { message: string },
  filtros: [] as [string, ...unknown[]][],
  colunas: '' as string,
  segredo: 'x'.repeat(40) as string | null,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      estado.filtros.push(['from', tabela])
      const consulta = {
        select: (colunas: string) => {
          estado.colunas = colunas
          return consulta
        },
        eq: (coluna: string, valor: unknown) => {
          estado.filtros.push(['eq', coluna, valor])
          return consulta
        },
        not: (coluna: string, op: string, valor: unknown) => {
          estado.filtros.push(['not', coluna, op, valor])
          return consulta
        },
        then: (ok: (r: unknown) => unknown, falha: (e: unknown) => unknown) =>
          Promise.resolve({ data: estado.erro ? null : estado.linhas, error: estado.erro }).then(ok, falha),
      }
      return consulta
    },
  }),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: async () => ({ accountId: 'conta-1', userId: 'u1' }),
  toErrorResponse: (e: unknown) => {
    throw e
  },
}))

vi.mock('@/lib/whatsapp/ligacoes/computador', async (original) => ({
  ...(await original<typeof import('@/lib/whatsapp/ligacoes/computador')>()),
  segredoDoCrm: () => estado.segredo,
}))

import { GET } from './route'

beforeEach(() => {
  estado.linhas = []
  estado.erro = null
  estado.filtros = []
  estado.colunas = ''
  estado.segredo = 'x'.repeat(40)
})

const agora = () => new Date().toISOString()
const haMinutos = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

describe('GET /api/cb/ligacoes/computadores', () => {
  it('a situação de cada um: pronto, fora (sem sinal há 3 min) e sem WhatsApp', async () => {
    estado.linhas = [
      { channel_id: 'canal-a', whatsapp: 'conectado', ultimo_sinal_em: agora(), ligado_em: haMinutos(60) },
      { channel_id: 'canal-b', whatsapp: 'conectado', ultimo_sinal_em: haMinutos(5), ligado_em: haMinutos(60) },
      { channel_id: 'canal-c', whatsapp: 'qr', ultimo_sinal_em: agora(), ligado_em: haMinutos(60) },
    ]
    const r = await GET()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      computadores: [
        { channel_id: 'canal-a', situacao: 'pronto' },
        { channel_id: 'canal-b', situacao: 'fora' },
        { channel_id: 'canal-c', situacao: 'sem_whatsapp' },
      ],
    })
    // Da conta, só os LIGADOS (o interruptor, 1137), e nunca o endereço nem o
    // nome do contêiner (infra interna).
    expect(estado.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
    expect(estado.filtros).toContainEqual(['not', 'ligado_em', 'is', null])
    expect(estado.colunas).not.toMatch(/endereco|nome/)
  })

  it('⚠️ leitura que falha é 500, nunca a lista vazia (o botão sumiria afirmando)', async () => {
    estado.erro = { message: 'o banco não respondeu' }
    const r = await GET()
    expect(r.status).toBe(500)
  })

  it('instalação sem o segredo das ligações: lista vazia, sem ler o banco', async () => {
    estado.segredo = null
    const r = await GET()
    expect(await r.json()).toEqual({ computadores: [] })
    expect(estado.filtros).toEqual([])
  })
})
