import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// POST /api/whatsapp/templates/submit — o que a rota GRAVA.
//
// Até 23/09/2026 a busca do modelo local era pelo AUTOR (`user_id`), feita
// DEPOIS da Meta, com o erro descartado. Dois danos, os dois cobertos aqui:
//   - reenviar pela tela "Criar" um nome que já existe faz a Meta recusar,
//     e o caminho de falha REBAIXAVA a linha aprovada para rascunho sem
//     `meta_template_id` — o modelo sumia dos disparos, da caixa de entrada
//     e das automações;
//   - com outro admin, a busca não achava o modelo do colega e nascia um
//     rascunho HOMÔNIMO (os índices únicos são por autor e deixam passar).
// ============================================================

vi.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}))

const requireRole = vi.fn()
vi.mock('@/lib/auth/account', () => ({
  requireRole: (papel: string) => requireRole(papel),
  toErrorResponse: () => ({ body: { error: 'Forbidden' }, init: { status: 403 } }),
  ForbiddenError: class ForbiddenError extends Error {},
  UnauthorizedError: class UnauthorizedError extends Error {},
}))

const submitMessageTemplate = vi.fn()
vi.mock('@/lib/whatsapp/meta-api', () => ({
  submitMessageTemplate: (a: unknown) => submitMessageTemplate(a),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: async () => {},
}))
vi.mock('@/lib/whatsapp/template-components', () => ({
  buildMetaTemplatePayload: () => ({ components: [] }),
}))
vi.mock('@/lib/cb-channels/resolve-meta', () => ({
  resolveMetaChannel: vi.fn(async () => ({
    channelId: 'canal-1',
    label: 'Comercial',
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
    wabaId: 'waba-1',
  })),
}))

interface Linha {
  id: string
  channel_id: string | null
  meta_template_id: string | null
}

interface ErroPg {
  code?: string
  message: string
}

/**
 * Banco falso só com o que a rota usa de `message_templates`: a busca
 * (`select … eq … order`), o `update … eq('id') … single` e o
 * `insert … single`. Registra tudo para as asserções.
 */
function bancoFalso(opcoes: {
  linhas?: Linha[]
  erroBusca?: ErroPg
  /** O que a SEGUNDA busca devolve (a da corrida do 23505). */
  linhasDepois?: Linha[]
  erroInsert?: ErroPg
  erroUpdate?: ErroPg
}) {
  const buscas: Record<string, unknown>[] = []
  const updates: { id: unknown; campos: Record<string, unknown> }[] = []
  const inserts: Record<string, unknown>[] = []

  const client = {
    from(tabela: string) {
      expect(tabela).toBe('message_templates')
      return {
        select() {
          const filtros: Record<string, unknown> = {}
          const consulta = {
            eq(coluna: string, valor: unknown) {
              filtros[coluna] = valor
              return consulta
            },
            async order() {
              buscas.push(filtros)
              if (buscas.length === 1) {
                return opcoes.erroBusca
                  ? { data: null, error: opcoes.erroBusca }
                  : { data: opcoes.linhas ?? [], error: null }
              }
              return { data: opcoes.linhasDepois ?? [], error: null }
            },
          }
          return consulta
        },
        update(campos: Record<string, unknown>) {
          return {
            eq(_coluna: string, id: unknown) {
              updates.push({ id, campos })
              return {
                select: () => ({
                  single: async () =>
                    opcoes.erroUpdate
                      ? { data: null, error: opcoes.erroUpdate }
                      : { data: { id, ...campos }, error: null },
                }),
              }
            },
          }
        },
        insert(linha: Record<string, unknown>) {
          inserts.push(linha)
          return {
            select: () => ({
              single: async () =>
                opcoes.erroInsert
                  ? { data: null, error: opcoes.erroInsert }
                  : { data: { id: 'nova', ...linha }, error: null },
            }),
          }
        },
      }
    },
  }
  return { client, buscas, updates, inserts }
}

const CORPO = {
  name: 'boas_vindas',
  category: 'Utility',
  language: 'pt_BR',
  body_text: 'Olá, tudo bem?',
}

function pedido(corpo: Record<string, unknown> = CORPO) {
  return new Request('http://localhost/api/whatsapp/templates/submit', {
    method: 'POST',
    body: JSON.stringify(corpo),
  })
}

type Resposta = { body: Record<string, unknown>; init?: { status?: number } }

async function enviar(banco: ReturnType<typeof bancoFalso>): Promise<Resposta> {
  requireRole.mockResolvedValue({
    supabase: banco.client,
    accountId: 'acct-1',
    userId: 'admin-que-clicou',
  })
  const { POST } = await import('./route')
  return (await POST(pedido())) as unknown as Resposta
}

const RECUSA = 'Meta API error: 400 — Content in this language already exists'

beforeEach(() => {
  vi.stubEnv('WHATSAPP_TEMPLATES_DRY_RUN', '')
})

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('templates/submit — a busca vem ANTES da Meta, pela conta', () => {
  it('(i) erro na busca: 500 e a Meta NÃO é chamada', async () => {
    const banco = bancoFalso({ erroBusca: { message: 'timeout' } })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await enviar(banco)

    expect(r.init?.status).toBe(500)
    expect(submitMessageTemplate).not.toHaveBeenCalled()
    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(0)
  })

  it('procura pela CONTA, nome e idioma — nunca pelo autor', async () => {
    const banco = bancoFalso({})
    let buscasQuandoAMetaFoiChamada = -1
    submitMessageTemplate.mockImplementation(async () => {
      buscasQuandoAMetaFoiChamada = banco.buscas.length
      return { id: 'hsm-1', status: 'PENDING' }
    })

    await enviar(banco)

    expect(banco.buscas[0]).toEqual({
      account_id: 'acct-1',
      name: 'boas_vindas',
      language: 'pt_BR',
    })
    expect(banco.buscas[0]).not.toHaveProperty('user_id')
    // A busca aconteceu ANTES da chamada à Meta.
    expect(buscasQuandoAMetaFoiChamada).toBe(1)
  })
})

describe('templates/submit — a Meta recusou', () => {
  it('(ii) linha APROVADA vinculada à Meta: nada é gravado, e a resposta traz o erro e a dica', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-antigo' }],
    })
    submitMessageTemplate.mockRejectedValue(new Error(RECUSA))

    const r = await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(0)
    expect(r.init?.status).toBe(502)
    expect(r.body).toEqual({ error: RECUSA, code: 'modelo_ja_existe' })
  })

  it('limite de taxa com linha vinculada: nada é gravado, e SEM a dica de "já existe"', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-antigo' }],
    })
    submitMessageTemplate.mockRejectedValue(new Error('Meta API error: 429'))

    const r = await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(r.init?.status).toBe(429)
    expect(r.body).not.toHaveProperty('code')
  })

  it('(iii) sem linha: insere o rascunho, com o autor e a conta', async () => {
    const banco = bancoFalso({})
    submitMessageTemplate.mockRejectedValue(new Error(RECUSA))

    const r = await enviar(banco)

    expect(r.init?.status).toBe(502)
    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(1)
    expect(banco.inserts[0]).toMatchObject({
      account_id: 'acct-1',
      user_id: 'admin-que-clicou',
      channel_id: 'canal-1',
      status: 'DRAFT',
      meta_template_id: null,
      submission_error: RECUSA,
    })
  })

  it('(iv) rascunho local (sem meta_template_id): atualiza aquela linha, sem trocar o autor', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'rascunho', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockRejectedValue(new Error(RECUSA))

    await enviar(banco)

    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].id).toBe('rascunho')
    expect(banco.updates[0].campos).toMatchObject({
      status: 'DRAFT',
      meta_template_id: null,
      submission_error: RECUSA,
    })
    expect(banco.updates[0].campos).not.toHaveProperty('user_id')
  })

  it('(vii) falha ao gravar o rascunho vai para o log, e a resposta continua sendo a da Meta', async () => {
    const banco = bancoFalso({ erroInsert: { message: 'permission denied' } })
    submitMessageTemplate.mockRejectedValue(new Error(RECUSA))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const r = await enviar(banco)

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('rascunho não gravado'),
      'permission denied',
    )
    expect(r.init?.status).toBe(502)
    expect(r.body).toEqual({ error: RECUSA })
  })
})

describe('templates/submit — a Meta aceitou', () => {
  it('(v) rascunho criado por OUTRO admin é achado pela conta: atualiza, não cria homônimo, e o autor fica', async () => {
    // A linha do colega: a busca não filtra por autor, então ela volta.
    const banco = bancoFalso({
      linhas: [{ id: 'do-colega', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.body).toMatchObject({ success: true })
    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].id).toBe('do-colega')
    expect(banco.updates[0].campos).toMatchObject({
      meta_template_id: 'hsm-novo',
      status: 'PENDING',
      submission_error: null,
    })
    // Reatribuir o autor é decisão pendente (M24): o update não o toca.
    expect(banco.updates[0].campos).not.toHaveProperty('user_id')
  })

  it('(vi) linha vinculada VELHA (a Meta aceitou de novo): religa com o id novo', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'velha', channel_id: 'canal-1', meta_template_id: 'hsm-apagado' }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    await enviar(banco)

    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toEqual([
      expect.objectContaining({
        id: 'velha',
        campos: expect.objectContaining({ meta_template_id: 'hsm-novo' }),
      }),
    ])
  })

  it('sem linha: insere com o autor e a conta', async () => {
    const banco = bancoFalso({})
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.body).toMatchObject({ success: true })
    expect(banco.inserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'admin-que-clicou',
        channel_id: 'canal-1',
        meta_template_id: 'hsm-novo',
      }),
    ])
  })

  it('corrida (23505 na inserção): busca de novo e religa a linha que venceu', async () => {
    const banco = bancoFalso({
      erroInsert: { code: '23505', message: 'duplicate key value' },
      linhasDepois: [{ id: 'venceu', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.body).toMatchObject({ success: true })
    expect(banco.buscas).toHaveLength(2)
    expect(banco.updates).toEqual([
      expect.objectContaining({
        id: 'venceu',
        campos: expect.objectContaining({ meta_template_id: 'hsm-novo' }),
      }),
    ])
  })

  it('falha ao gravar depois da Meta aceitar: 500 com o id da Meta', async () => {
    const banco = bancoFalso({ erroInsert: { message: 'boom' } })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.init?.status).toBe(500)
    expect(r.body).toMatchObject({ meta_template_id: 'hsm-novo' })
  })
})

describe('templates/submit — qual linha é a do modelo', () => {
  it('prefere a linha do canal à global de antes da 903', async () => {
    const banco = bancoFalso({
      linhas: [
        { id: 'global', channel_id: null, meta_template_id: 'hsm-g' },
        { id: 'do-canal', channel_id: 'canal-1', meta_template_id: 'hsm-c' },
      ],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    await enviar(banco)

    expect(banco.updates.map((u) => u.id)).toEqual(['do-canal'])
  })

  it('no mesmo canal, prefere a vinculada à Meta ao homônimo que o bug antigo criou', async () => {
    const banco = bancoFalso({
      linhas: [
        { id: 'homonimo', channel_id: 'canal-1', meta_template_id: null },
        { id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-1' },
      ],
    })
    submitMessageTemplate.mockRejectedValue(new Error(RECUSA))

    const r = await enviar(banco)

    // Achou a aprovada: não grava nada e devolve a dica.
    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(0)
    expect(r.body).toMatchObject({ code: 'modelo_ja_existe' })
  })

  it('linha de OUTRO número não é a deste modelo: nasce uma linha nova', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'outro-numero', channel_id: 'canal-2', meta_template_id: 'hsm-2' }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(1)
  })
})
