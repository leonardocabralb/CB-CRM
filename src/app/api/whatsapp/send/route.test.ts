import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the `contact_id` send path (issue #296): sending an approved
// template to a single contact from the Contact detail view. The route must
// find-or-create the contact's conversation server-side, then run the normal
// send + persistence path — no inbound message required to bootstrap a thread.
// ---------------------------------------------------------------------------

// Records of what the route wrote, so we can assert the right rows landed.
const conversationInserts: Array<Record<string, unknown>> = []
const messageInserts: Array<Record<string, unknown>> = []
// UPDATEs em `conversations` — o pino do canal (`pinConversationChannel`).
const conversationUpdates: Array<Record<string, unknown>> = []
// A linha de `cb_channels` que o canal escolhido resolve (Fase 11.3).
let channelRow: Record<string, unknown> | null = null

// Toggles for the per-test scenario.
let existingConversation: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
// The caller's role, as `requireRole` reads it off the profile. Sending
// requires 'agent'; 'viewer' must be refused before anything reaches Meta.
let callerRole: string = 'admin'
// A conversation created during the request becomes retrievable by id —
// the shared send core re-loads the conversation (with its contact) from
// just the id, so the mock must model insert-then-select-by-id.
let createdConversation: Record<string, unknown> | null = null
// A corrida (porte do #680): outra requisição cria a conversa entre a busca
// e o INSERT, que leva o 23505 da UNIQUE da 0036.
let conversationCreatedConcurrently: Record<string, unknown> | null = null
// A leitura de `conversations` que FALHA: sempre, só a releitura depois do
// INSERT recusado, ou com o id que nem é uuid (22P02 = não existe).
let conversationReadFails: 'sempre' | 'depois_do_insert' | 'id_invalido' | null = null
// A leitura de `contacts` que FALHA (o soluço do banco, não "não existe").
let contactReadFails = false

const CONTACT = {
  id: 'contact-1',
  account_id: 'acct-1',
  phone: '+15551234567',
}

// Chainable Supabase mock. A fresh builder per `.from()` call tracks whether
// `.insert()` ran so the terminal resolves to the inserted row for creates
// and the canned select row otherwise.
/** Papel do usuário autenticado no mock. Reposto a cada teste. */

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return {
            data: { account_id: 'acct-1', account_role: callerRole },
            error: null,
          }
        case 'accounts':
          // `owner_user_id` alimenta o dono durável da conversa criada —
          // deliberadamente DIFERENTE do caller ('user-1') para o teste
          // flagrar uma regressão que volte a gravar quem clicou.
          return {
            data: { id: 'acct-1', name: 'Acme', owner_user_id: 'owner-1' },
            error: null,
          }
        case 'contacts':
          if (contactReadFails) {
            return { data: null, error: { code: 'XX000', message: 'leitura falhou' } }
          }
          return { data: contactRow, error: null }
        case 'conversations':
          if (conversationReadFails === 'id_invalido') {
            return { data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } }
          }
          if (
            conversationReadFails === 'sempre' ||
            (conversationReadFails === 'depois_do_insert' &&
              conversationInserts.length > 0)
          ) {
            return { data: null, error: { code: 'XX000', message: 'leitura falhou' } }
          }
          // Once created this request, a by-id reload returns it (with
          // its contact); otherwise fall back to the canned existing row.
          return { data: createdConversation ?? existingConversation, error: null }
        case 'whatsapp_config':
          return {
            data: {
              id: 'cfg-1',
              account_id: 'acct-1',
              phone_number_id: 'PNID-1',
              access_token: 'enc-token',
            },
            error: null,
          }
        case 'message_templates':
          return { data: null, error: null }
        case 'cb_channels':
          return { data: channelRow, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const insertResult = () => {
      switch (table) {
        case 'conversations':
          if (conversationCreatedConcurrently) {
            return {
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' },
            }
          }
          return {
            data: {
              id: 'conv-new',
              account_id: 'acct-1',
              contact_id: 'contact-1',
              contact: CONTACT,
            },
            error: null,
          }
        case 'messages':
          return { data: { id: 'msg-1' }, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const terminal = () =>
      Promise.resolve(didInsert ? insertResult() : selectResult())

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'delete']) {
      b[m] = vi.fn(chain)
    }
    b.update = vi.fn((payload: Record<string, unknown>) => {
      if (table === 'conversations') conversationUpdates.push(payload)
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'conversations') {
        conversationInserts.push(payload)
        if (conversationCreatedConcurrently) {
          // A outra requisição venceu: a conversa dela é a que existe.
          existingConversation = conversationCreatedConcurrently
          return b
        }
        createdConversation = {
          id: 'conv-new',
          account_id: 'acct-1',
          contact_id: 'contact-1',
          contact: CONTACT,
        }
      }
      if (table === 'messages') messageInserts.push(payload)
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    b.then = (resolve: (v: unknown) => unknown) =>
      resolve(didInsert ? insertResult() : selectResult())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {}
      const chain = () => b
      for (const m of ['update', 'eq', 'select']) b[m] = vi.fn(chain)
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null })
      return b
    },
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'plaintext-token'),
  encrypt: vi.fn(() => 'enc-token'),
  isLegacyFormat: vi.fn(() => false),
}))

const { sendTemplateMessage } = vi.hoisted(() => ({
  sendTemplateMessage: vi.fn(async () => ({ messageId: 'wamid-1' })),
}))
// O resto do módulo é o real: a falha do envio é classificada pela classe
// `MetaApiError` de verdade (`motivoDaFalhaDoNucleo`).
vi.mock('@/lib/whatsapp/meta-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/whatsapp/meta-api')>()),
  sendTemplateMessage,
  sendTextMessage: vi.fn(),
  sendMediaMessage: vi.fn(),
}))

import { POST } from './route'
// A régua REAL da bolha: a resposta da rota tem de ser lida como a tela a lê.
import { falhaDaResposta } from '@/lib/inbox/falha-do-envio'

function postContactTemplate(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contact_id: 'contact-1',
        message_type: 'template',
        template_name: 'order_update',
        template_language: 'en_US',
        template_message_params: { body: ['Acme', '#1234'] },
        template_params: ['Acme', '#1234'],
        ...overrides,
      }),
    }),
  )
}

describe('POST /api/whatsapp/send — contact_id template path', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    existingConversation = null
    createdConversation = null
    conversationCreatedConcurrently = null
    conversationReadFails = null
    contactReadFails = false
    contactRow = CONTACT
    callerRole = 'admin'
    supabaseMock = makeSupabaseMock()
    sendTemplateMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('corrida: o INSERT leva o 23505 e o envio segue na conversa que a outra requisição criou', async () => {
    conversationCreatedConcurrently = {
      id: 'conv-raced',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }

    const res = await postContactTemplate()
    expect(res.status).toBe(200)

    expect(conversationInserts).toHaveLength(1)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(messageInserts[0]).toMatchObject({ conversation_id: 'conv-raced' })
  })

  it('leitura da conversa que FALHA é erro: 503 "barrado", sem tentar criar nem enviar', async () => {
    conversationReadFails = 'sempre'

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/look up the conversation/i)
    expect(falhaDaResposta(res.status, json).motivo).toBe('barrado')
    expect(conversationInserts).toHaveLength(0)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('corrida com a releitura que falha: 503 sem enviar', async () => {
    conversationCreatedConcurrently = {
      id: 'conv-raced',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }
    conversationReadFails = 'depois_do_insert'

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.error).toMatch(/look up the conversation/i)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(messageInserts).toHaveLength(0)
  })

  it('leitura do CONTATO que falha é erro (503 "barrado"), não "Contact not found"', async () => {
    contactReadFails = true

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.code).toBe('lookup_failed')
    expect(falhaDaResposta(res.status, json).motivo).toBe('barrado')
    expect(conversationInserts).toHaveLength(0)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('creates a conversation for a contact with none, then sends the template', async () => {
    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.whatsapp_message_id).toBe('wamid-1')

    // A conversation was created for this contact — owned by the ACCOUNT
    // OWNER, not the caller: `conversations.user_id` cascades from
    // `auth.users`, so stamping the operator would delete the client's
    // thread on that operator's offboarding (plano 31/08, #11).
    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      user_id: 'owner-1',
    })

    // The template was sent to the contact's number.
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    const args = (sendTemplateMessage.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >
    // Meta wants the bare E.164 digits — sanitizePhoneForMeta strips the '+'.
    expect(args.to).toBe('15551234567')
    expect(args.templateName).toBe('order_update')

    // The outbound message was persisted under the new conversation.
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      conversation_id: 'conv-new',
      content_type: 'template',
      template_name: 'order_update',
      sender_type: 'agent',
    })
  })

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }

    const res = await postContactTemplate()
    expect(res.status).toBe(200)

    expect(conversationInserts).toHaveLength(0)
    expect(messageInserts[0]).toMatchObject({ conversation_id: 'conv-existing' })
  })

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/contact not found/i)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('400s when neither conversation_id nor contact_id is provided', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_type: 'template', template_name: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  // A guarda de papel: até ela existir, um convidado somente-leitura
  // ENVIAVA mensagem para o cliente. A RLS não protegia — o efeito
  // colateral (chamada à Meta/Evolution) acontece antes de qualquer
  // gravação, então o banco nunca entrava no caminho.
  it('403s para viewer, sem chegar a enviar nada', async () => {
    callerRole = 'viewer'
    try {
      const { POST } = await import('./route')
      const res = await POST(
        new Request('http://localhost/api/whatsapp/send', {
          method: 'POST',
          body: JSON.stringify({ conversation_id: 'conv-1', content: 'oi' }),
        }),
      )
      // 403 ANTES de qualquer envio: a guarda é a primeira coisa depois de
      // resolver a conta, então um 403 aqui significa que nada saiu para o
      // cliente. Antes dela, este mesmo pedido entregava a mensagem.
      expect(res.status).toBe(403)
    } finally {
      callerRole = 'agent'
    }
  })
})

describe('POST /api/whatsapp/send — role enforcement', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }
    createdConversation = null
    contactRow = CONTACT
    callerRole = 'admin'
    supabaseMock = makeSupabaseMock()
    sendTemplateMessage.mockClear()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a viewer with 403 and never reaches Meta', async () => {
    // A viewer is read-only (`canSendMessages`). The route used to resolve
    // account_id straight off the profile with no role check: RLS blocked
    // the message INSERT, but the send core calls Meta first, so the
    // customer still received a real WhatsApp message that RLS could not
    // un-send. The gate has to come before any outbound call.
    callerRole = 'viewer'

    const res = await postContactTemplate()

    expect(res.status).toBe(403)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(messageInserts).toHaveLength(0)
  })

  it('allows an agent through', async () => {
    callerRole = 'agent'

    const res = await postContactTemplate()

    expect(res.status).toBe(200)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// O caminho da caixa de entrada (`conversation_id`): a leitura da conversa que
// FALHA não é "não encontrada" (CLAUDE.md, 8b) — o `.single()` de antes dava
// 404 também no soluço do banco. Nada saiu: a bolha tem de ler "barrado",
// nunca "pode ter saído" (o 5xx sem motivo).
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/send — leitura da conversa pelo id', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    existingConversation = null
    createdConversation = null
    conversationCreatedConcurrently = null
    conversationReadFails = null
    contactReadFails = false
    contactRow = CONTACT
    callerRole = 'agent'
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    conversationReadFails = null
    vi.clearAllMocks()
  })

  const enviarTexto = () =>
    POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: '00000000-0000-4000-8000-000000000001',
          message_type: 'text',
          content_text: 'Bom dia',
        }),
      }),
    )

  it('leitura que falha: 503 "barrado" (nada saiu), nunca 404 nem "pode ter saído"', async () => {
    conversationReadFails = 'sempre'

    const res = await enviarTexto()
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json.code).toBe('lookup_failed')
    const falha = falhaDaResposta(res.status, json)
    expect(falha.motivo).toBe('barrado')
    expect(falha.detalhe).toMatch(/load the conversation/i)
    expect(messageInserts).toHaveLength(0)
  })

  it('conversa que não existe (ou de outra conta) segue 404', async () => {
    const res = await enviarTexto()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/conversation not found/i)
  })

  it('id que nem é uuid (22P02) é "não encontrada", não falha do banco', async () => {
    conversationReadFails = 'id_invalido'
    const res = await enviarTexto()
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// A falha do envio diz POR QUÊ (19/10/2026): a bolha otimista lê `motivo` e
// só oferece "Tentar de novo" na recusa comprovada. O `error` de sempre fica.
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/send — o motivo da falha na resposta', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    conversationUpdates.length = 0
    messageInserts.length = 0
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
      contact: CONTACT,
    }
    createdConversation = null
    contactRow = CONTACT
    callerRole = 'agent'
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // 31/10/2026 (decisão do operador): a falha do PROVEDOR fica GRAVADA, com
  // quem tentou — os colegas veem, e ela sobrevive à recarga. A linha não é
  // fala (`nao_saiu`), e a resposta leva o id para a tela trocar a otimista.
  it('recusa 4xx da Meta: "recusado", com o código e o error de sempre — e a tentativa GRAVADA de quem tentou', async () => {
    const { MetaApiError } = await import('@/lib/whatsapp/meta-api')
    sendTemplateMessage.mockRejectedValueOnce(
      new MetaApiError('Template does not exist', { httpStatus: 400, code: 132001 }),
    )

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json).toMatchObject({ code: 'meta_error', motivo: 'recusado', mensagem_id: 'msg-1' })
    expect(json.error).toMatch(/Meta API error/)
    expect(json.detalhe).toMatch(/Template does not exist/)
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({
      sender_type: 'agent',
      // Quem APERTOU enviar (o login), nunca o dono da conta.
      sender_id: 'user-1',
      content_type: 'template',
      status: 'failed',
      nao_saiu: true,
      error_title: 'recusado',
      error_code: 132001,
    })
    expect(messageInserts[0]).not.toHaveProperty('message_id')
    // A conversa sobe na lista, como com a tentativa do robô.
    expect(conversationUpdates.some((u) => 'last_message_text' in u)).toBe(true)
  })

  it('5xx da Meta: "incerto" — pode ter saído, a bolha não oferece reenvio; gravada como incerta', async () => {
    const { MetaApiError } = await import('@/lib/whatsapp/meta-api')
    sendTemplateMessage.mockRejectedValueOnce(new MetaApiError('Service unavailable', { httpStatus: 503 }))

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(502)
    expect(json).toMatchObject({ code: 'meta_error', motivo: 'incerto', mensagem_id: 'msg-1' })
    expect(messageInserts).toHaveLength(1)
    expect(messageInserts[0]).toMatchObject({ sender_type: 'agent', nao_saiu: true, error_title: 'incerto' })
  })

  it('o que parou NO CRM (sem chegar ao provedor) não é gravado: fica só na tela de quem tentou', async () => {
    // Ficha sem telefone nem BSUID: o núcleo recusa ANTES da Meta
    // (`bad_request`), e o erro não leva `tentativa`.
    contactRow = { ...CONTACT, phone: null, wa_user_id: null }
    existingConversation = { ...existingConversation!, contact: contactRow }

    const res = await postContactTemplate()
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(sendTemplateMessage).not.toHaveBeenCalled()
    expect(json.mensagem_id).toBeUndefined()
    expect(messageInserts).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Fase 11.3 — o canal ESCOLHIDO e a ficha só-BSUID.
//
// A ficha de quem a Meta identifica só pelo nome de usuário (BSUID, sem
// telefone) só é alcançável pela API oficial. O núcleo recusaria o envio por
// uma conexão por QR Code — mas DEPOIS de `pinConversationChannel` prender a
// conversa naquele número, e a conversa ficaria fixada onde não alcança o
// cliente. A rota confere ANTES do pino.
// ---------------------------------------------------------------------------
describe('POST /api/whatsapp/send — canal escolhido × ficha só-BSUID', () => {
  const BSUID = 'BR.13491208655302741918'

  function postComCanal(channelId: string) {
    return POST(
      new Request('http://localhost/api/whatsapp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: 'conv-existing',
          message_type: 'text',
          content_text: 'oi',
          channel_id: channelId,
        }),
      }),
    )
  }

  beforeEach(() => {
    conversationInserts.length = 0
    messageInserts.length = 0
    conversationUpdates.length = 0
    createdConversation = null
    callerRole = 'agent'
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('só-BSUID + conexão por QR Code: 400 com o motivo, e a conversa NÃO é fixada', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      group_id: null,
      contact: { id: 'contact-1', phone: null, wa_user_id: BSUID },
    }
    channelRow = { id: 'ch-evo', kind: 'evolution' }

    const res = await postComCanal('ch-evo')
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.code).toBe('not_supported')
    expect(json.error).toMatch(/número oficial/)
    expect(conversationUpdates.filter((u) => 'channel_pinned' in u)).toEqual([])
    expect(messageInserts).toEqual([])
  })

  it('com telefone, a mesma conexão por QR Code é fixada como sempre', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      group_id: null,
      contact: { id: 'contact-1', phone: '+5583988887777', wa_user_id: BSUID },
    }
    channelRow = { id: 'ch-evo', kind: 'evolution' }

    await postComCanal('ch-evo')

    expect(conversationUpdates).toContainEqual({
      channel_id: 'ch-evo',
      channel_pinned: true,
    })
  })

  it('só-BSUID + conexão da Meta: a conversa é fixada (é o número que alcança)', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      group_id: null,
      contact: { id: 'contact-1', phone: null, wa_user_id: BSUID },
    }
    channelRow = { id: 'ch-meta', kind: 'meta' }

    await postComCanal('ch-meta')

    expect(conversationUpdates).toContainEqual({
      channel_id: 'ch-meta',
      channel_pinned: true,
    })
  })
})
