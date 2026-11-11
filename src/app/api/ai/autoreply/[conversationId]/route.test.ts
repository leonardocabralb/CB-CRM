import { beforeEach, describe, expect, it, vi } from 'vitest'

// POST /api/ai/autoreply/[conversationId] — o "Pausar/Retomar IA" da faixa
// do fio (D26 do docs/PLANO-agentes-de-ia.md). Os pinos: pausar grava o
// motivo `botao`; retomar limpa os três campos da pausa, carimba
// `ia_retomada_em` (o teto volta a contar dali) e NUNCA menciona o
// responsável humano; 0 linhas no UPDATE é erro; grupo e Instagram recusados.

type Linha = Record<string, unknown> | null

let conversa: Linha
let canal: Linha
/** A última mensagem do cliente com conexão (`canalDaIaNaConversa`). */
let ultimaDoCliente: Linha
let erroDaUltima: { message: string } | null
let linhasGravadas: Array<{ id: string }> | null
let erroDoUpdate: { message: string } | null
let erroDoCanal: { message: string } | null
let papelRecusado: boolean
const updates: Array<Record<string, unknown>> = []
/** O filtro `.or()` do UPDATE (o "Pausar" não rebaixa a pausa permanente, 1138). */
const filtrosOr: string[] = []
const leituras: Array<{ tabela: string; filtros: Array<[string, unknown]> }> = []

function leitura(tabela: string, resposta: () => { data: Linha; error: unknown }) {
  const filtros: Array<[string, unknown]> = []
  leituras.push({ tabela, filtros })
  const cadeia = {
    eq: (coluna: string, valor: unknown) => {
      filtros.push([coluna, valor])
      return cadeia
    },
    not: (coluna: string, op: string, valor: unknown) => {
      filtros.push([`not.${coluna}.${op}`, valor])
      return cadeia
    },
    in: () => cadeia,
    is: (coluna: string, valor: unknown) => {
      filtros.push([`is.${coluna}`, valor])
      return cadeia
    },
    order: () => cadeia,
    limit: () => cadeia,
    maybeSingle: async () => resposta(),
    // Lista (as últimas mensagens do cliente, `canalDaIaNaConversa`).
    then: (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) => {
      const r = resposta()
      return Promise.resolve({ data: r.data ? [r.data] : [], error: r.error }).then(ok, erro)
    },
  }
  return cadeia
}

const supabase = {
  from: (tabela: string) => ({
    select: () => {
      if (tabela === 'conversations') return leitura(tabela, () => ({ data: conversa, error: null }))
      if (tabela === 'cb_channels') return leitura(tabela, () => ({ data: canal, error: erroDoCanal }))
      if (tabela === 'messages') return leitura(tabela, () => ({ data: ultimaDoCliente, error: erroDaUltima }))
      throw new Error(`leitura inesperada em ${tabela}`)
    },
    update: (payload: Record<string, unknown>) => {
      if (tabela !== 'conversations') throw new Error(`update inesperado em ${tabela}`)
      updates.push(payload)
      const cadeia = {
        eq: () => cadeia,
        or: (f: string) => {
          filtrosOr.push(f)
          return cadeia
        },
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

// O "Retomar" antecipa o turno que esperava a equipe (1138): a fila pelo
// cliente de SERVIÇO e o disparo do turno são dublês.
const antecipadas: Array<Record<string, unknown>> = []
let turnosAntecipados: Array<{ id: string; executar_apos: string }> = []
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => ({
      update: (payload: Record<string, unknown>) => {
        const filtros: Array<[string, unknown]> = []
        antecipadas.push({ tabela, payload, filtros })
        const cadeia = {
          eq: (c: string, v: unknown) => (filtros.push([c, v]), cadeia),
          select: async () => ({ data: turnosAntecipados, error: null }),
        }
        return cadeia
      },
    }),
  }),
}))
vi.mock('@/lib/ia-agentes/turno', () => ({ agendarTurno: vi.fn() }))

import { requireRole } from '@/lib/auth/account'
import { agendarTurno } from '@/lib/ia-agentes/turno'
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
  ultimaDoCliente = null
  erroDaUltima = null
  linhasGravadas = [{ id: 'conv-1' }]
  erroDoUpdate = null
  erroDoCanal = null
  papelRecusado = false
  updates.length = 0
  filtrosOr.length = 0
  antecipadas.length = 0
  turnosAntecipados = []
  vi.mocked(agendarTurno).mockReset()
  leituras.length = 0
})

describe('POST /api/ai/autoreply — pausar', () => {
  it('grava a pausa com o motivo `botao` e o instante', async () => {
    const res = await chamar({ paused: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, paused: true, permanente: false })
    expect(updates).toHaveLength(1)
    const [u] = updates
    expect(u.ai_autoreply_disabled).toBe(true)
    expect(u.ia_pausada_por).toBe('botao')
    expect(typeof u.ia_pausada_em).toBe('string')
    expect(Number.isNaN(Date.parse(u.ia_pausada_em as string))).toBe(false)
    expect('assigned_agent_id' in u).toBe(false)
    expect('ia_retomada_em' in u).toBe(false)
  })

  it('pausar nunca atribui a conversa (o "Assumir" saiu), nem a pedido', async () => {
    await chamar({ paused: true, assign_to_me: true })
    expect('assigned_agent_id' in updates[0]).toBe(false)
  })

  it('o "Pausar" (temporário, 1138) só casa sem pausa ou com a temporária: nunca rebaixa a desativada', async () => {
    await chamar({ paused: true })
    expect(filtrosOr).toEqual(['ai_autoreply_disabled.eq.false,ia_pausada_por.in.(gente,botao)'])
  })

  it('o Pausar sobre a pausa permanente (0 linhas) é 409, nunca sucesso', async () => {
    linhasGravadas = []
    const res = await chamar({ paused: true })
    expect(res.status).toBe(409)
  })
})

describe('POST /api/ai/autoreply — retomar com mensagem esperando a equipe (1138)', () => {
  it('o turno que esperava a equipe passa a vencer AGORA e é disparado (a IA responde na hora)', async () => {
    turnosAntecipados = [{ id: 'turno-1', executar_apos: '2026-11-11T18:00:00Z' }]
    const res = await chamar({ paused: false })
    expect(res.status).toBe(200)
    expect(antecipadas).toHaveLength(1)
    expect(antecipadas[0]).toMatchObject({ tabela: 'cb_ia_turnos', payload: expect.objectContaining({ erro: null }) })
    expect(antecipadas[0].filtros).toEqual(
      expect.arrayContaining([
        ['account_id', 'conta-1'],
        ['conversation_id', 'conv-1'],
        ['status', 'aguardando'],
        ['tipo', 'resposta'],
        ['erro', 'aguardando a equipe responder'],
      ]),
    )
    expect(agendarTurno).toHaveBeenCalledWith({ id: 'turno-1', executarApos: '2026-11-11T18:00:00Z' })
  })

  it('pausar e desativar não antecipam nada', async () => {
    await chamar({ paused: true })
    await chamar({ paused: true, permanente: true })
    expect(antecipadas).toHaveLength(0)
  })
})

describe('POST /api/ai/autoreply — desativar (1138)', () => {
  it('grava `desativada` (permanente até o Retomar), por cima de qualquer pausa', async () => {
    const res = await chamar({ paused: true, permanente: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, paused: true, permanente: true })
    expect(updates[0]).toMatchObject({ ai_autoreply_disabled: true, ia_pausada_por: 'desativada' })
    expect(filtrosOr).toEqual([])
    expect('ia_retomada_em' in updates[0]).toBe(false)
  })

  it('`permanente` que não é booleano é 400, sem escrever', async () => {
    const res = await chamar({ paused: true, permanente: 'sim' })
    expect(res.status).toBe(400)
    expect(updates).toHaveLength(0)
  })
})

describe('POST /api/ai/autoreply — retomar', () => {
  it('limpa os três campos da pausa, carimba ia_retomada_em e NÃO menciona o responsável humano', async () => {
    const res = await chamar({ paused: false, assign_to_me: true })
    expect(res.status).toBe(200)
    expect(updates).toHaveLength(1)
    const [u] = updates
    expect(u.ai_autoreply_disabled).toBe(false)
    expect(u.ia_pausada_por).toBeNull()
    expect(u.ia_pausada_em).toBeNull()
    expect(typeof u.ia_retomada_em).toBe('string')
    expect(Number.isNaN(Date.parse(u.ia_retomada_em as string))).toBe(false)
    // O teto conta as mensagens do agente depois de `ia_retomada_em`: o
    // contador legado não é mais escrito.
    expect('ai_reply_count' in u).toBe(false)
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

  it('a conexão é a da ÚLTIMA mensagem do cliente, a mesma da faixa (Codex, #309)', async () => {
    // Fixada no Instagram, mas o cliente escreveu por último no WhatsApp:
    // é o agente do WhatsApp que a faixa mostra, e o botão tem de valer.
    conversa = { id: 'conv-1', group_id: null, channel_id: 'canal-instagram' }
    ultimaDoCliente = { channel_id: 'canal-1', content_type: 'text', content_text: 'oi', media_type: null }
    const res = await chamar({ paused: true })
    expect(res.status).toBe(200)
    const doCanal = leituras.find((l) => l.tabela === 'cb_channels')
    expect(doCanal?.filtros).toContainEqual(['id', 'canal-1'])
    const daMensagem = leituras.find((l) => l.tabela === 'messages')
    expect(daMensagem?.filtros).toEqual([
      ['conversation_id', 'conv-1'],
      ['sender_type', 'customer'],
      ['not.channel_id.is', null],
      ['is.deleted_at', null],
    ])
  })

  it('erro ao ler a última mensagem falha FECHADO (500, nada gravado)', async () => {
    erroDaUltima = { message: 'timeout' }
    const res = await chamar({ paused: false })
    expect(res.status).toBe(500)
    expect(updates).toHaveLength(0)
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
