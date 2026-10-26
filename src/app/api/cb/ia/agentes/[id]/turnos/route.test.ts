import { beforeEach, describe, expect, it, vi } from 'vitest'

// GET /api/cb/ia/agentes/[id]/turnos — a sub-aba Turnos (só admin): os 50
// últimos turnos do agente, com o contato de cada conversa e o RETRATO do
// que o modelo viu (F3) e as AÇÕES que o agente fez (F4). A conta é
// conferida no agente E em cada consulta (cliente de serviço).

const ID = '11111111-1111-4111-8111-111111111111'

type Consulta = { tabela: string; colunas: string; filtros: Array<[string, ...unknown[]]> }
const consultas: Consulta[] = []
let turnos: unknown[] | null
let erroDosTurnos: { message: string } | null
let agenteDaConta: unknown

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/ia-agentes/repo', () => ({
  obterAgente: vi.fn(async () => agenteDaConta),
  ErroDoAgente: class extends Error {},
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      select: (colunas: string) => {
        const c: Consulta = { tabela, colunas, filtros: [] }
        consultas.push(c)
        const q: Record<string, unknown> = {}
        for (const m of ['eq', 'in', 'order', 'limit']) {
          q[m] = (...a: unknown[]) => {
            c.filtros.push([m, ...a])
            return q
          }
        }
        q.then = (ok: (v: unknown) => unknown) =>
          Promise.resolve(
            tabela === 'cb_ia_turnos'
              ? { data: turnos, error: erroDosTurnos }
              : {
                  data: [
                    { id: 'conv-1', contact: { name: 'Maria', phone: '5511999990000' } },
                    { id: 'conv-2', contact: { name: null, phone: '5511888880000' } },
                  ],
                  error: null,
                },
          ).then(ok)
        return q
      },
    }),
  }),
}))

import { requireRole } from '@/lib/auth/account'
import { GET } from './route'

const chamar = () => GET(new Request('http://x'), { params: Promise.resolve({ id: ID }) })

beforeEach(() => {
  consultas.length = 0
  agenteDaConta = { id: ID }
  erroDosTurnos = null
  turnos = [
    // A RETOMADA (1056) que ainda espera na fila: tentativa, total e vencimento.
    {
      id: 't3', status: 'aguardando', created_at: '2026-09-26T12:05:00Z', terminado_em: null, erro: null, conversation_id: 'conv-1',
      contexto: null, acoes: [], tipo: 'retomada', tentativa: 2, tentativas: 6, executar_apos: '2026-09-26T13:00:00Z',
    },
    {
      id: 't2', status: 'passou', created_at: '2026-09-26T12:00:00Z', terminado_em: null, erro: null, conversation_id: 'conv-2',
      contexto: { blocos: [{ bloco: 'ficha', texto: 'Customer record: no details on file.' }, { bloco: 7 }], documentos: ['doc-1', 3] },
      acoes: [
        { tipo: 'mover_etapa', alvo: { id: 'etapa-1', nome: 'Bancário · Proposta' }, ok: true },
        { tipo: 'etiquetar', alvo: { id: null, nome: '#4' }, ok: false, erro: 'fora_da_lista' },
        { tipo: 'etiquetar', alvo: { id: 't1', nome: 'Quente' }, ok: false, erro: 'cascata_fora_da_d5', detalhe: 'send_webhook' },
        { tipo: 7 },
      ],
    },
    { id: 't1', status: 'falhou', created_at: '2026-09-26T11:00:00Z', terminado_em: '2026-09-26T11:00:05Z', erro: 'sem chave', conversation_id: 'conv-1', contexto: null, acoes: [] },
  ]
})

describe('GET /api/cb/ia/agentes/[id]/turnos', () => {
  it('os 50 últimos do agente, da conta, mais novos primeiro, com o contato', async () => {
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(requireRole).toHaveBeenCalledWith('admin')
    const corpo = (await res.json()) as { turnos: Record<string, unknown>[] }
    expect(corpo.turnos).toEqual([
      {
        id: 't3', status: 'aguardando', criadoEm: '2026-09-26T12:05:00Z', terminadoEm: null, erro: null, conversationId: 'conv-1', contato: 'Maria',
        contexto: null, acoes: [], retomada: { tentativa: 2, de: 6 }, executarApos: '2026-09-26T13:00:00Z', conteudoRemovido: null,
      },
      {
        id: 't2', status: 'passou', criadoEm: '2026-09-26T12:00:00Z', terminadoEm: null, erro: null, conversationId: 'conv-2', contato: '5511888880000',
        // O retrato é LIDO (parse): item fora da forma sai, nunca vai cru à tela.
        contexto: { blocos: [{ bloco: 'ficha', texto: 'Customer record: no details on file.' }], documentos: ['doc-1'], trechos: [] },
        // As ações (F4), também LIDAS: a linha fora da forma sai.
        acoes: [
          { tipo: 'mover_etapa', alvo: { id: 'etapa-1', nome: 'Bancário · Proposta' }, ok: true },
          { tipo: 'etiquetar', alvo: { id: null, nome: '#4' }, ok: false, erro: 'fora_da_lista' },
          // O código e o detalhe cru, separados.
          { tipo: 'etiquetar', alvo: { id: 't1', nome: 'Quente' }, ok: false, erro: 'cascata_fora_da_d5', detalhe: 'send_webhook' },
        ],
        // O turno de resposta (e o anterior à 1056, sem as colunas): sem retomada.
        retomada: null,
        conteudoRemovido: null,
      },
      { id: 't1', status: 'falhou', criadoEm: '2026-09-26T11:00:00Z', terminadoEm: '2026-09-26T11:00:05Z', erro: 'sem chave', conversationId: 'conv-1', contato: 'Maria', contexto: null, acoes: [], retomada: null, conteudoRemovido: null },
    ])
    const dosTurnos = consultas.find((c) => c.tabela === 'cb_ia_turnos')!
    expect(dosTurnos.colunas).toContain('contexto')
    expect(dosTurnos.colunas).toContain('acoes')
    for (const col of ['tipo', 'tentativa', 'tentativas', 'executar_apos', 'conteudo_removido_em', 'conteudo_removido_por']) {
      expect(dosTurnos.colunas).toContain(col)
    }
    expect(dosTurnos.filtros).toEqual([
      ['eq', 'account_id', 'conta-1'],
      ['eq', 'ia_agente_id', ID],
      ['order', 'created_at', { ascending: false }],
      ['limit', 50],
    ])
    const dosContatos = consultas.find((c) => c.tabela === 'conversations')!
    expect(dosContatos.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
  })

  it('1110: o turno da conversa APAGADA (ou na Lixeira) vem sem conversa e sem contato; o conteúdo removido vem com quando e por quê', async () => {
    turnos = [
      {
        id: 't9', status: 'incerto', created_at: '2026-10-26T12:00:00Z', terminado_em: '2026-10-26T12:00:03Z', erro: 'conversa apagada',
        conversation_id: null, contexto: null,
        acoes: [{ tipo: 'mover_etapa', alvo: { id: 'etapa-1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' }],
        tipo: 'resposta', tentativa: null, tentativas: null, executar_apos: '2026-10-26T12:00:00Z',
        conteudo_removido_em: '2026-10-27T03:00:00Z', conteudo_removido_por: 'exclusao',
      },
      { ...(turnos![2] as object), conversation_id: 'conv-1', conteudo_removido_em: null, conteudo_removido_por: null },
    ]
    const corpo = (await (await chamar()).json()) as { turnos: Record<string, unknown>[] }
    expect(corpo.turnos[0]).toMatchObject({
      conversationId: null,
      contato: null,
      erro: 'conversa apagada',
      contexto: null,
      acoes: [{ tipo: 'mover_etapa', alvo: { id: 'etapa-1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' }],
      conteudoRemovido: { em: '2026-10-27T03:00:00Z', por: 'exclusao' },
    })
    expect(corpo.turnos[1]).toMatchObject({ conversationId: 'conv-1', contato: 'Maria', conteudoRemovido: null })
    // A conversa nula não vai para a consulta dos contatos.
    const dosContatos = consultas.find((c) => c.tabela === 'conversations')!
    expect(dosContatos.filtros).toContainEqual(['in', 'id', ['conv-1']])
  })

  it('só turnos sem conversa: nem consulta os contatos', async () => {
    turnos = [
      {
        id: 't9', status: 'descartado', created_at: '2026-10-26T12:00:00Z', terminado_em: null, erro: 'conversa apagada',
        conversation_id: null, contexto: null, acoes: [], tipo: 'resposta', tentativa: null, tentativas: null, executar_apos: null,
        conteudo_removido_em: null, conteudo_removido_por: null,
      },
    ]
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(consultas.map((c) => c.tabela)).toEqual(['cb_ia_turnos'])
    expect(((await res.json()) as { turnos: Record<string, unknown>[] }).turnos[0]).toMatchObject({
      conversationId: null,
      contato: null,
      conteudoRemovido: null,
    })
  })

  it('agente de outra conta (ou inexistente): 404, sem ler turno nenhum', async () => {
    agenteDaConta = null
    expect((await chamar()).status).toBe(404)
    expect(consultas).toHaveLength(0)
  })

  it('erro ao ler os turnos: 500, nunca lista vazia', async () => {
    erroDosTurnos = { message: 'timeout' }
    expect((await chamar()).status).toBe(500)
  })
})
