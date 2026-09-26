import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/cb/ia/conversa/[id] — o que a faixa do fio diz (D24–D27): o
// agente da ETAPA do card aberto que ATENDERIA a conversa, e a pausa. Para
// qualquer membro, com a conta da sessão em toda consulta. A regra é a do
// motor (`quemResponde`, a de verdade — não é mockada aqui).
// ============================================================

const CONV = '11111111-1111-4111-8111-111111111111'

type Consulta = { tabela: string; filtros: Array<[string, ...unknown[]]> }
const consultas: Consulta[] = []
let banco: Record<string, unknown>

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1', role: 'viewer' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 401 })),
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      select: () => {
        const c: Consulta = { tabela, filtros: [] }
        consultas.push(c)
        const q: Record<string, unknown> = {}
        for (const m of ['eq', 'order', 'limit', 'not']) {
          q[m] = (...a: unknown[]) => {
            c.filtros.push([m, ...a])
            return q
          }
        }
        q.maybeSingle = async () => ({ data: banco[tabela] ?? null, error: banco[`${tabela}:erro`] ?? null })
        return q
      },
    }),
  }),
}))

import { GET } from './route'

function chamar() {
  return GET(new Request('http://x'), { params: Promise.resolve({ conversationId: CONV }) })
}

beforeEach(() => {
  consultas.length = 0
  banco = {
    conversations: {
      id: CONV,
      contact_id: 'ct-1',
      group_id: null,
      channel_id: 'canal-1',
      ai_autoreply_disabled: false,
      ia_pausada_por: null,
    },
    cb_channels: { kind: 'evolution' },
    deals: { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' },
    cb_ia_agente_etapas: { ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' },
    cb_ia_agentes: {
      id: 'ag-1',
      nome: 'Triagem',
      ativo: true,
      arquivado_em: null,
      conexoes: ['canal-1'],
      ativado_em: '2026-09-20T12:00:00Z',
    },
  }
})

describe('GET /api/cb/ia/conversa/[id]', () => {
  it('card aberto numa etapa com agente: a faixa diz quem responde', async () => {
    const res = await chamar()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      agente: { id: 'ag-1', nome: 'Triagem' },
      pausada: false,
      pausadaPor: null,
      motivo: null,
    })
  })

  it('o card é o ABERTO mais recente do contato, na conta da sessão', async () => {
    await chamar()
    const card = consultas.find((c) => c.tabela === 'deals')!
    expect(card.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
    expect(card.filtros).toContainEqual(['eq', 'contact_id', 'ct-1'])
    expect(card.filtros).toContainEqual(['eq', 'status', 'open'])
    expect(card.filtros).toContainEqual(['order', 'created_at', { ascending: false }])
    // `messages` não tem conta: é lida pela conversa, já conferida na conta.
    for (const c of consultas.filter((x) => x.tabela !== 'messages')) {
      expect(c.filtros).toContainEqual(['eq', 'account_id', 'conta-1'])
    }
  })

  it('⚠️ D27: card que já estava na etapa antes de ela ser marcada — ninguém', async () => {
    banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-01T00:00:00Z' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'card_antigo' })
  })

  it('sem card, etapa sem agente, agente desligado', async () => {
    banco.deals = null
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'sem_card' })
    banco.deals = { id: 'd1', stage_id: 'e1', pipeline_id: 'f1', etapa_desde: '2026-09-25T12:00:00Z' }
    banco.cb_ia_agente_etapas = null
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'etapa_sem_agente' })
    banco.cb_ia_agente_etapas = { ia_agente_id: 'ag-1', desde: '2026-09-21T12:00:00Z' }
    banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativo: false }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'agente_desligado' })
  })

  it('pausada: devolve o motivo e AINDA o agente (a faixa oferece Retomar)', async () => {
    banco.conversations = {
      ...(banco.conversations as object),
      ai_autoreply_disabled: true,
      ia_pausada_por: 'gente',
    }
    expect(await (await chamar()).json()).toMatchObject({
      agente: { id: 'ag-1', nome: 'Triagem' },
      pausada: true,
      pausadaPor: 'gente',
    })
  })

  it('⚠️ D27: card que entrou na etapa antes de o agente ser LIGADO — ninguém', async () => {
    banco.cb_ia_agentes = { ...(banco.cb_ia_agentes as object), ativado_em: '2026-09-26T00:00:00Z' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'card_antigo' })
  })

  it('encerrada: ninguém atende (a faixa não oferece Pausar) — Codex, #309', async () => {
    banco.conversations = { ...(banco.conversations as object), status: 'closed' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'encerrada' })
  })

  it('a conexão é a da ÚLTIMA mensagem do cliente, não a fixada na conversa — Codex, #309', async () => {
    banco.conversations = { ...(banco.conversations as object), channel_id: 'canal-2' }
    banco.messages = { channel_id: 'canal-1' }
    expect(await (await chamar()).json()).toMatchObject({ agente: { id: 'ag-1', nome: 'Triagem' } })
    const ultima = consultas.find((c) => c.tabela === 'messages')!
    expect(ultima.filtros).toContainEqual(['eq', 'conversation_id', CONV])
    expect(ultima.filtros).toContainEqual(['eq', 'sender_type', 'customer'])
  })

  it('conexão da conversa fora das do agente — ninguém', async () => {
    banco.conversations = { ...(banco.conversations as object), channel_id: 'canal-2' }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_da_conexao' })
  })

  it('grupo e Instagram: ninguém, sem nem procurar card', async () => {
    banco.conversations = { ...(banco.conversations as object), group_id: 'g-1', contact_id: null }
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_do_alcance' })
    expect(consultas.some((c) => c.tabela === 'deals')).toBe(false)
    banco.conversations = { ...(banco.conversations as object), group_id: null, contact_id: 'ct-1' }
    banco.cb_channels = { kind: 'instagram' }
    consultas.length = 0
    expect(await (await chamar()).json()).toMatchObject({ agente: null, motivo: 'fora_do_alcance' })
    expect(consultas.some((c) => c.tabela === 'deals')).toBe(false)
  })

  it('conversa de outra conta (ou inexistente): 404', async () => {
    banco.conversations = null
    expect((await chamar()).status).toBe(404)
  })

  it('erro de banco é 500, nunca "ninguém responde"', async () => {
    banco['deals:erro'] = { message: 'timeout' }
    expect((await chamar()).status).toBe(500)
  })
})
