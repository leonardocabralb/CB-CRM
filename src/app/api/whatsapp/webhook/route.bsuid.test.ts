import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============================================================
// A entrada do BSUID pelo webhook da Meta (Fase 11.2 do plano do merge do
// upstream; #519/#533 do original). Irmão de `route.test.ts`, com o mesmo
// harness, mas com `contacts` e `conversations` EM MEMÓRIA — as cercas no
// WHERE (`.is(...)`, `.eq(...)`) e os índices únicos (BSUID por conta, 1038;
// telefone, 1024) são imitados, porque é neles que mora o comportamento:
// duas entregas só-BSUID → UMA ficha; preenchimentos que só escrevem em
// branco; o 23505 que manda a mensagem para a ficha do BSUID.
// ============================================================

type Linha = Record<string, unknown> & { id: string }

const h = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  findExistingContact: vi.fn(),
  fichaQueVenceu: vi.fn(),
  state: {
    contatos: [] as Linha[],
    conversas: [] as Linha[],
    inserts: [] as Record<string, unknown>[],
    updates: [] as { patch: Record<string, unknown>; linhas: number }[],
    /** Leituras de `contacts` que falham antes de responder (o blip). */
    falhasDeLeitura: 0,
    /** INSERT de ficha que perde a corrida: a vencedora entra no meio. */
    vencedoraNaCorrida: null as Linha | null,
    seq: 0,
    upserts: [] as Record<string, unknown>[],
    afterCallbacks: [] as (() => Promise<void> | void)[],
  },
}))

function violacao(linha: Record<string, unknown>, propria: string | null) {
  for (const r of h.state.contatos) {
    if (r.id === propria || r.account_id !== linha.account_id) continue
    if (linha.wa_user_id && r.wa_user_id === linha.wa_user_id) {
      return { code: '23505', message: 'idx_contacts_account_wa_user_id' }
    }
    const a = String(linha.phone ?? '').replace(/\D/g, '')
    const b = String(r.phone ?? '').replace(/\D/g, '')
    if (a && a === b) return { code: '23505', message: 'contacts_telefone_canonico' }
  }
  return null
}

function consulta(tabela: 'contacts' | 'conversations') {
  let op: 'select' | 'update' | 'insert' = 'select'
  let patch: Record<string, unknown> = {}
  let novo: Record<string, unknown> = {}
  const filtros: ((r: Linha) => boolean)[] = []
  const linhas = () => (tabela === 'contacts' ? h.state.contatos : h.state.conversas)

  function executar(uma: boolean) {
    if (op === 'insert') {
      if (tabela === 'contacts') {
        if (h.state.vencedoraNaCorrida) {
          h.state.contatos.push(h.state.vencedoraNaCorrida)
          h.state.vencedoraNaCorrida = null
        }
        const erro = violacao(novo, null)
        if (erro) return { data: null, error: erro }
      }
      const linha = { id: `${tabela}-${++h.state.seq}`, ...novo } as Linha
      linhas().push(linha)
      if (tabela === 'contacts') h.state.inserts.push(novo)
      return { data: linha, error: null }
    }
    const casadas = linhas().filter((r) => filtros.every((f) => f(r)))
    if (op === 'update') {
      if (tabela === 'contacts') {
        for (const r of casadas) {
          const erro = violacao({ ...r, ...patch }, r.id)
          if (erro) return { data: null, error: erro }
        }
        h.state.updates.push({ patch, linhas: casadas.length })
      }
      casadas.forEach((r) => Object.assign(r, patch))
      return { data: null, error: null, count: casadas.length }
    }
    if (tabela === 'contacts' && h.state.falhasDeLeitura > 0) {
      h.state.falhasDeLeitura--
      return { data: null, error: { message: 'blip' } }
    }
    return uma ? { data: casadas[0] ?? null, error: null } : { data: casadas, error: null }
  }

  const q: Record<string, unknown> = {
    select: () => q,
    update: (p: Record<string, unknown>) => {
      op = 'update'
      patch = p
      return q
    },
    insert: (r: Record<string, unknown>) => {
      op = 'insert'
      novo = r
      return q
    },
    eq: (c: string, v: unknown) => {
      filtros.push((r) => r[c] === v)
      return q
    },
    is: (c: string, v: unknown) => {
      filtros.push((r) => (r[c] ?? null) === v)
      return q
    },
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve(executar(true)),
    single: () => Promise.resolve(executar(true)),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(executar(false)).then(res, rej),
  }
  return q
}

vi.mock('next/server', () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb)
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case 'whatsapp_config':
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: [
                    { account_id: 'acc-1', user_id: 'user-1', access_token: 'enc', mirror_inbound_media: false },
                  ],
                  error: null,
                }),
            }),
          }
        case 'contacts':
          return consulta('contacts')
        case 'conversations':
          return consulta('conversations')
        case 'broadcast_recipients': {
          const c: Record<string, unknown> = {
            select: () => c,
            eq: () => c,
            in: () => c,
            order: () => c,
            limit: () => Promise.resolve({ data: [], error: null }),
          }
          return c
        }
        case 'messages':
          return {
            select: (_c: string, options?: { head?: boolean }) =>
              options?.head
                ? { eq: () => ({ eq: () => Promise.resolve({ count: 0, error: null }) }) }
                : { eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) },
            upsert: (row: Record<string, unknown>) => {
              h.state.upserts.push(row)
              return { select: () => Promise.resolve({ data: [{ id: `msg-${h.state.upserts.length}` }], error: null }) }
            },
          }
        // `cancelarEsperasPorResposta` e afins: nenhuma espera nestes casos.
        case 'automation_pending_executions':
        case 'cb_channels': {
          const chain: Record<string, unknown> = {
            select: () => chain,
            eq: () => chain,
            order: () => chain,
            limit: () => chain,
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
            then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null }),
          }
          return chain
        }
        default:
          throw new Error(`unexpected table: ${table}`)
      }
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
    storage: { from: () => ({ upload: () => Promise.resolve({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'plain-token',
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}))
vi.mock('@/lib/whatsapp/meta-api', () => ({ getMediaUrl: vi.fn(), downloadMedia: vi.fn() }))
// A busca por telefone lê a MESMA tabela em memória (pelos dígitos), e é
// espiada: sem telefone ela nunca pode ser chamada.
vi.mock('@/lib/contacts/dedupe', () => ({
  ESPERAS_DA_RELEITURA_MS: [0, 0],
  findExistingContact: h.findExistingContact,
  fichaQueVenceu: h.fichaQueVenceu,
  isUniqueViolation: (e: { code?: string } | null) => e?.code === '23505',
}))
vi.mock('@/lib/whatsapp/webhook-signature', () => ({ verifyMetaWebhookSignature: () => true }))
vi.mock('@/lib/whatsapp/template-webhook', () => ({
  isTemplateWebhookField: () => false,
  handleTemplateWebhookChange: vi.fn(),
}))
vi.mock('@/lib/automations/engine', () => ({ runAutomationsForTrigger: h.runAutomationsForTrigger }))
vi.mock('@/lib/flows/engine', () => ({ dispatchInboundToFlows: h.dispatchInboundToFlows }))
vi.mock('@/lib/ai/auto-reply', () => ({ dispatchInboundToAiReply: h.dispatchInboundToAiReply }))
vi.mock('@/lib/cb-channels/stamp', async () => {
  const real = await vi.importActual<typeof import('@/lib/cb-channels/stamp')>('@/lib/cb-channels/stamp')
  return {
    stampMessageChannel: vi.fn(async () => {}),
    followConversationChannel: vi.fn(async () => {}),
    pinConversationChannel: vi.fn(async () => {}),
    gravarComCanal: real.gravarComCanal,
    violouFkDoCanal: real.violouFkDoCanal,
  }
})
vi.mock('@/lib/cb-channels/resolve-inbound', () => ({
  // O dono DURÁVEL da conta — de propósito diferente do `user_id` da linha de
  // `whatsapp_config` ('user-1', quem conectou o número).
  donoDaConta: vi.fn(async () => 'dono-da-conta'),
  resolveInboundMetaChannelId: vi.fn(async () => null),
  resolveInboundMetaChannel: vi.fn(async () => null),
}))
vi.mock('@/lib/cb-channels/pipeline-routing', () => ({ routeContactToPipeline: vi.fn(async () => {}) }))
vi.mock('@/lib/webhooks/deliver', () => ({ dispatchWebhookEvent: h.dispatchWebhookEvent }))

import { POST } from './route'

const BSUID = 'US.13491208655302741918'
const OUTRO_BSUID = 'US.99999999999999999999'
const TELEFONE = '5583988745316'

let wamid = 0
function mensagem(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `wamid.T${++wamid}`,
    timestamp: String(Math.floor(Date.now() / 1000)),
    type: 'text',
    text: { body: 'oi' },
    ...extra,
  }
}

async function entregar(messages: Record<string, unknown>[], contacts?: Record<string, unknown>[]) {
  const value: Record<string, unknown> = { metadata: { phone_number_id: 'pn-1' }, messages }
  if (contacts !== undefined) value.contacts = contacts
  const body = { entry: [{ changes: [{ field: 'messages', value }] }] }
  await POST({ text: async () => JSON.stringify(body), headers: { get: () => 'sha256=stub' } } as unknown as Request)
  const pendentes = h.state.afterCallbacks.splice(0)
  for (const cb of pendentes) await cb()
}

function porDigitos(phone: string) {
  const d = String(phone).replace(/\D/g, '')
  return h.state.contatos.find((r) => r.phone && String(r.phone).replace(/\D/g, '') === d) ?? null
}

beforeEach(() => {
  vi.clearAllMocks()
  h.state.contatos = []
  h.state.conversas = []
  h.state.inserts = []
  h.state.updates = []
  h.state.falhasDeLeitura = 0
  h.state.vencedoraNaCorrida = null
  h.state.seq = 0
  h.state.upserts = []
  h.state.afterCallbacks = []
  h.findExistingContact.mockImplementation(async (_db: unknown, _acc: string, phone: string) => ({
    contato: porDigitos(phone),
    falhou: false,
  }))
  h.fichaQueVenceu.mockImplementation(async (_db: unknown, _acc: string, phone: string) => ({
    contato: porDigitos(phone),
    falhou: false,
  }))
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  h.dispatchInboundToAiReply.mockResolvedValue(undefined)
  h.dispatchWebhookEvent.mockResolvedValue(undefined)
  h.runAutomationsForTrigger.mockResolvedValue(undefined)
})

function ficha(extra: Partial<Linha> & { id: string }): Linha {
  const l = { account_id: 'acc-1', user_id: 'user-1', name: null, phone: null, wa_user_id: null, ...extra } as Linha
  h.state.contatos.push(l)
  return l
}

const disparos = (evento: string) =>
  h.runAutomationsForTrigger.mock.calls.filter((c) => c[0] === evento || c[1] === evento).length

describe('entrada só-BSUID (a Meta sem telefone)', () => {
  it('conta sem dono resolvível: nada é criado — nunca cai para quem conectou o número', async () => {
    const { donoDaConta } = await import('@/lib/cb-channels/resolve-inbound')
    vi.mocked(donoDaConta).mockResolvedValueOnce(null)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    await entregar([mensagem({ from_user_id: BSUID })], [{ user_id: BSUID, profile: { name: 'Ana' } }])
    expect(h.state.contatos).toHaveLength(0)
    expect(h.state.conversas).toHaveLength(0)
    expect(h.state.upserts).toHaveLength(0)
    expect(erro).toHaveBeenCalledWith(
      '[whatsapp-webhook] conta sem dono resolvível; mensagens descartadas:',
      expect.anything(),
    )
    erro.mockRestore()
  })

  it('duas entregas só-BSUID → UMA ficha (phone NULL, nunca ""), UMA conversa, UM conversation.created', async () => {
    const semTelefone = [{ user_id: BSUID, profile: { name: 'Ana' } }]
    await entregar([mensagem({ from_user_id: BSUID })], semTelefone)
    await entregar([mensagem({ from_user_id: BSUID })], semTelefone)

    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.contatos[0]).toMatchObject({ phone: null, wa_user_id: BSUID, name: 'Ana' })
    // O dono é o da CONTA, nunca quem conectou o número (`whatsapp_config.user_id`).
    expect(h.state.contatos[0].user_id).toBe('dono-da-conta')
    expect(h.state.inserts[0].phone).toBeNull()
    expect(h.state.conversas).toHaveLength(1)
    expect(h.state.upserts).toHaveLength(2)
    const criadas = h.dispatchWebhookEvent.mock.calls.filter((c) => c[2] === 'conversation.created')
    expect(criadas).toHaveLength(1)
  })

  it('sem telefone, a busca pelos 8 finais NUNCA roda (os dígitos do BSUID casariam com um celular)', async () => {
    await entregar([mensagem({ from_user_id: BSUID })], [{ user_id: BSUID, profile: { name: 'Ana' } }])
    expect(h.findExistingContact).not.toHaveBeenCalled()
  })

  it('o nome é só o do PERFIL: sem ele, a ficha nasce sem nome — nunca o BSUID nem o @', async () => {
    await entregar(
      [mensagem({ from_user_id: BSUID })],
      [{ user_id: BSUID, profile: { name: '', username: 'ana.silva' } }],
    )
    expect(h.state.contatos[0].name).toBeNull()
    expect(h.state.contatos[0].wa_username).toBe('ana.silva')
  })

  it('nem telefone nem BSUID → nada é criado (nem ficha, nem conversa, nem mensagem)', async () => {
    await entregar([mensagem()], [])
    expect(h.state.contatos).toHaveLength(0)
    expect(h.state.conversas).toHaveLength(0)
    expect(h.state.upserts).toHaveLength(0)
  })

  it('entrega SEM `contacts` é descartada, como no original — é o formato da mensagem de sistema', async () => {
    // A Meta manda o aviso de troca de número sem `contacts`. Com o portão
    // relaxado (a 1ª versão da 11.2), ele entrava como fala do cliente
    // (revisão da Fase 11).
    await entregar([mensagem({ from: TELEFONE, type: 'system', system: { type: 'user_changed_number', body: 'x' } })])
    await entregar([mensagem({ from_user_id: BSUID })])
    expect(h.state.contatos).toHaveLength(0)
    expect(h.state.upserts).toHaveLength(0)
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })

  it('mensagem de SISTEMA não vira fala do cliente, mesmo vindo com `contacts`', async () => {
    ficha({ id: 'c-antiga', phone: TELEFONE, name: 'Ana' })
    await entregar(
      [mensagem({ from: TELEFONE, type: 'system', system: { type: 'user_changed_user_id', user_id: BSUID } })],
      [{ wa_id: TELEFONE, profile: { name: 'Ana' } }],
    )
    expect(h.state.upserts).toHaveLength(0)
    expect(h.state.conversas).toHaveLength(0)
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled()
    expect(h.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled()
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })

  it('`contacts: []` não estoura: o remetente está na mensagem e ela é processada', async () => {
    await entregar([mensagem({ from_user_id: BSUID })], [])
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.upserts).toHaveLength(1)
  })

  it('reação só-BSUID de quem não tem ficha não cria ficha nem conversa', async () => {
    await entregar(
      [mensagem({ from_user_id: BSUID, type: 'reaction', reaction: { message_id: 'wamid.X', emoji: '👍' } })],
      [{ user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos).toHaveLength(0)
    expect(h.state.conversas).toHaveLength(0)
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled()
  })
})

describe('preenchimentos: telefone + BSUID', () => {
  it('ficha achada pelo TELEFONE ganha o BSUID (a próxima, sem telefone, cai nela)', async () => {
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Ana' })
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.contatos[0].wa_user_id).toBe(BSUID)

    await entregar([mensagem({ from_user_id: BSUID })], [{ user_id: BSUID, profile: { name: 'Ana' } }])
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.conversas).toHaveLength(1)
  })

  it('ficha de NOME FIXADO recebe o BSUID e mantém o nome (UPDATEs separados)', async () => {
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Nome do Calendly', nome_fixado_em: '2026-09-20T10:00:00Z' })
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Perfil do WhatsApp' } }],
    )
    expect(h.state.contatos[0]).toMatchObject({ wa_user_id: BSUID, name: 'Nome do Calendly' })
  })

  it('ficha que já tem OUTRO BSUID não é sobrescrita', async () => {
    ficha({ id: 'c-tel', phone: TELEFONE, wa_user_id: OUTRO_BSUID })
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos.find((r) => r.id === 'c-tel')!.wa_user_id).toBe(OUTRO_BSUID)
  })

  it('ficha só-BSUID ganha o telefone quando a Meta enfim o manda (sem ficha nova)', async () => {
    ficha({ id: 'c-bsuid', wa_user_id: BSUID, name: 'Ana' })
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.contatos[0].phone).toBe(TELEFONE)
  })

  it('telefone já gravado na ficha do BSUID não é reescrito', async () => {
    ficha({ id: 'c-bsuid', wa_user_id: BSUID, phone: '5583900000000', name: 'Ana' })
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos.find((r) => r.id === 'c-bsuid')!.phone).toBe('5583900000000')
  })

  it('23505 no telefone (outra ficha já tem o número): log, sem fusão, a mensagem fica na ficha do BSUID', async () => {
    ficha({ id: 'c-bsuid', wa_user_id: BSUID, name: 'Ana' })
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Ana (Evolution)' })
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.contatos).toHaveLength(2)
    expect(h.state.contatos.find((r) => r.id === 'c-bsuid')!.phone).toBeNull()
    expect(h.state.conversas).toHaveLength(1)
    expect(h.state.conversas[0].contact_id).toBe('c-bsuid')
    expect(aviso.mock.calls.some((c) => String(c[0]).includes('ficha duplicada'))).toBe(true)
    aviso.mockRestore()
  })

  it('23505 no BSUID (a ficha do BSUID nasceu no meio): a mensagem vai para ELA', async () => {
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Ana' })
    // A ficha do BSUID aparece entre a busca (vazia) e o preenchimento.
    h.findExistingContact.mockImplementationOnce(async (_db: unknown, _acc: string, phone: string) => {
      ficha({ id: 'c-bsuid', wa_user_id: BSUID, name: 'Ana' })
      return { contato: porDigitos(phone), falhou: false }
    })
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.conversas[0].contact_id).toBe('c-bsuid')
    expect(h.state.contatos.find((r) => r.id === 'c-tel')!.wa_user_id).toBeNull()
    aviso.mockRestore()
  })
})

describe('leitura e corrida', () => {
  it('a busca pelo BSUID que FALHA é repetida (não cai no telefone com a ficha do BSUID existindo)', async () => {
    // A ficha do telefone já tem OUTRO BSUID (o número mudou de dono): ali não
    // há preenchimento nem o 23505 que resgataria a mensagem — só a releitura
    // da busca pelo BSUID a leva à ficha certa.
    ficha({ id: 'c-bsuid', wa_user_id: BSUID, name: 'Ana' })
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Dono antigo do número', wa_user_id: OUTRO_BSUID })
    h.state.falhasDeLeitura = 1
    await entregar(
      [mensagem({ from: TELEFONE, from_user_id: BSUID })],
      [{ wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } }],
    )
    expect(h.state.conversas[0].contact_id).toBe('c-bsuid')
  })

  it('corrida do INSERT (23505 do BSUID): relê pelo BSUID e usa a vencedora', async () => {
    h.state.vencedoraNaCorrida = {
      id: 'c-venceu',
      account_id: 'acc-1',
      user_id: 'user-1',
      wa_user_id: BSUID,
      phone: null,
      name: 'Ana',
    }
    await entregar([mensagem({ from_user_id: BSUID })], [{ user_id: BSUID, profile: { name: 'Ana' } }])
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.conversas[0].contact_id).toBe('c-venceu')
    expect(h.state.upserts).toHaveLength(1)
  })
})

describe('pareamento do contacts[] e o formato antigo', () => {
  it('com duas pessoas no mesmo POST, o BSUID de uma nunca vai para a outra', async () => {
    const outroTelefone = '5583900001111'
    await entregar(
      [mensagem({ from: TELEFONE }), mensagem({ from: outroTelefone })],
      // Fora de ordem: a entrada de cada pessoa está na posição da OUTRA.
      [
        { wa_id: outroTelefone, user_id: OUTRO_BSUID, profile: { name: 'Bia' } },
        { wa_id: TELEFONE, user_id: BSUID, profile: { name: 'Ana' } },
      ],
    )
    expect(porDigitos(TELEFONE)).toMatchObject({ wa_user_id: BSUID, name: 'Ana' })
    expect(porDigitos(outroTelefone)).toMatchObject({ wa_user_id: OUTRO_BSUID, name: 'Bia' })
  })

  it('payload antigo, com telefone e sem BSUID: acha pelo telefone, sem tocar nas colunas do BSUID', async () => {
    ficha({ id: 'c-tel', phone: TELEFONE, name: 'Ana' })
    await entregar([mensagem({ from: TELEFONE })], [{ wa_id: TELEFONE, profile: { name: 'Ana' } }])
    expect(h.findExistingContact).toHaveBeenCalledTimes(1)
    expect(h.state.contatos).toHaveLength(1)
    expect(h.state.updates.some((u) => 'wa_user_id' in u.patch)).toBe(false)
    expect(disparos('new_contact_created')).toBe(0)
  })
})
