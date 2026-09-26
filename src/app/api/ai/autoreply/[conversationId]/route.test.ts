import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/ai/autoreply/[conversationId] — o "Pausar/Retomar IA" do fio
// (5.4 e E13 do docs/PLANO-agentes-de-ia.md). Os pinos: pausar grava o motivo
// `botao`; retomar limpa os três campos da pausa e NUNCA menciona o
// responsável humano; 0 linhas no UPDATE é erro; grupo e Instagram recusados.

type Linha = Record<string, unknown> | null

let conversa: Linha
let canal: Linha
let linhasGravadas: Array<{ id: string }> | null
let erroDoUpdate: { message: string } | null
let erroDoCanal: { message: string } | null
let papelRecusado: boolean
const updates: Array<Record<string, unknown>> = []
const leituras: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = []

function leitura(tabela: string, resposta: () => { data: Linha; error: unknown }) {
  const filtros: Array<[string, unknown]> = []
  leituras.push({ tabela, filtros })
  const cadeia = {
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor])
      return cadeia
    },
    maybeSingle: async () => resposta(),
  }
  return cadeia
}

const supabase = {
  from: (tabela: string) => ({
    select: () => {
      if (tabela === 'conversations') return leitura(tabela, () => ({ data: conversa, error: null }))
      if (tabela === 'cb_channels') return leitura(tabela, () => ({ data: canal, error: erroDoCanal }))
      throw new Error(`leitura inesperada em ${tabela}`)
    },
    update: (payload: Record<string, unknown>) => {
      if (tabela !== 'conversations') throw new Error(`update inesperado em ${tabela}`)
      updates.push(payload)
      const cadeia = {
        eq: () => cadeia,
        select: async () => ({ data: linhasGravadas, error: erroDoUpdate }),
      }
      return cadeia
    },
  }),
}

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async (min: string) => {
    if (papelRecusado) throw Object.assign(new Error('Forbidden'), { status: 403, min })
    return { supabase, accountId: 'conta-1', userId: 'user-1', role: 'agent' }
  }),
  toErrorResponse: vi.fn(
    (err: { status?: number }) => new Response('erro', { status: err.status ?? 500 }),
  ),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => new Response('limite', { status: 429 }),
  RATE_LIMITS: { send: {} },
}))

import { requireRole } from '@/lib/auth/account'
import { POST } from './route'

function chamar(corpo: unknown) {
  return POST(
    new Request('http://x/api/ai/autoreply/conv-1', {
      method: 'POST',
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ conversationId: 'conv-1' }) },
  )
}

beforeEach(() => {
  conversa = { id: 'conv-1', group_id: null, channel_id: 'canal-1' }
  canal = { kind: 'evolution' }
  linhasGravadas = [{ id: 'conv-1' }]
  erroDoUpdate = null
  erroDoCanal = null
  papelRecusado = false
  updates.length = 0
  leituras.length = 0
})

describe('POST /api/ai/autoreply — pausar', () => {
  it('grava a pausa com o motivo `botao` e o instante', async () => {
    const res = await chamar({ paused: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, paused: true })
    expect(updates).toHaveLength(1)
    const [u] = updates
    expect(u.ai_autoreply_disabled).toBe(true)
    expect(u.ia_pausada_por).toBe('botao')
    expect(typeof u.ia_pausada_em).toBe('string')
    expect(Number.isNaN(Date.parse(u.ia_pausada_em as string))).toBe(false)
    expect('assigned_agent_id' in u).toBe(false)
  })

  it('com assign_to_me, atribui a quem clicou', async () => {
    await chamar({ paused: true, assign_to_me: true })
    expect(updates[0].assigned_agent_id).toBe('user-1')
  })
})

describe('POST /api/ai/autoreply — retomar', () => {
  it('limpa os três campos da pausa e NÃO menciona o responsável humano', async () => {
    const res = await chamar({ paused: false, assign_to_me: true })
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    const [u] = updates
    expect(u.ai_autoreply_disabled).toBe(false)
    expect(u.ia_pausada_por).toBeNull()
    expect(u.ia_pausada_em).toBeNull()
    expect(u.ai_reply_count).toBe(0)
    expect(u.ai_handoff_summary).toBeNull()
    // Pino da E13: o upstream zerava `assigned_agent_id` aqui.
    expect('assigned_agent_id' in u).toBe(false)
  })
})

describe('POST /api/ai/autoreply — linhas conferidas', () => {
  it('UPDATE que volta 0 linhas é erro, nunca sucesso', async () => {
    linhasGravadas = []
    const res = await chamar({ paused: true })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('nada_gravado')
  })

  it('erro do UPDATE é 500', async () => {
    erroDoUpdate = { message: 'boom' }
    const res = await chamar({ paused: false })
    expect(res.status).toBe(500)
  })
})

describe('POST /api/ai/autoreply — onde a IA não atua', () => {
  it('recusa conversa de grupo sem escrever', async () => {
    conversa = { id: 'conv-1', group_id: 'grupo-1', channel_id: null }
    for (const paused of [true, false]) {
      const res = await chamar({ paused })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('grupo')
    }
    expect(updates).toHaveLength(0)
  })

  it('recusa conversa cuja conexão é Instagram, sem escrever', async () => {
    canal = { kind: 'instagram' }
    for (const paused of [true, false]) {
      const res = await chamar({ paused })
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('instagram')
    }
    expect(updates).toHaveLength(0)
    // A conexão é lida DENTRO da conta.
    const doCanal = leituras.find((l) => l.tabela === 'cb_channels')
    expect(doCanal?.filtros).toEqual([
      ['id', 'canal-1'],
      ['account_id', 'conta-1'],
    ])
  })

  it('erro ao ler a conexão falha FECHADO (500, nada gravado)', async () => {
    erroDoCanal = { message: 'timeout' }
    const res = await chamar({ paused: false })
    expect(res.status).toBe(500)
    expect(updates).toHaveLength(0)
  })

  it('conversa sem conexão (legado de WhatsApp) não consulta canal e grava', async () => {
    conversa = { id: 'conv-1', group_id: null, channel_id: null }
    const res = await chamar({ paused: true })
    expect(res.status).toBe(200)
    expect(leituras.some((l) => l.tabela === 'cb_channels')).toBe(false)
    expect(updates).toHaveLength(1)
  })

  it('conversa de outra conta (ou inexistente) é 404', async () => {
    conversa = null
    const res = await chamar({ paused: true })
    expect(res.status).toBe(404)
    expect(updates).toHaveLength(0)
    const daConversa = leituras.find((l) => l.tabela === 'conversations')
    expect(daConversa?.filtros).toContainEqual(['account_id', 'conta-1'])
  })
})

describe('POST /api/ai/autoreply — guarda de papel e corpo', () => {
  it('exige papel agent', async () => {
    await chamar({ paused: true })
    expect(requireRole).toHaveBeenCalledWith('agent')
    updates.length = 0
    papelRecusado = true
    const res = await chamar({ paused: true })
    expect(res.status).toBe(403)
    expect(updates).toHaveLength(0)
  })

  it('corpo sem `paused` booleano é 400', async () => {
    const res = await chamar({ paused: 'sim' })
    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})
