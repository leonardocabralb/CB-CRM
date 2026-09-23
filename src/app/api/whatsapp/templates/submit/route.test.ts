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
//
// O banco falso tem ESTADO e APLICA os filtros (eq/is) da busca e do
// UPDATE: gravar pela coluna errada, ou sem a cerca de `meta_template_id`,
// muda a tabela e reprova — não basta a rota "chamar update".
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

/** Linha da tabela. Conta, nome e idioma têm o padrão do pedido. */
interface Linha {
  id: string
  channel_id: string | null
  meta_template_id: string | null
  account_id?: string
  name?: string
  language?: string
  status?: string
}

type Registro = Record<string, unknown>
type Filtro = ['eq' | 'is', string, unknown]

interface ErroPg {
  code?: string
  message: string
}

/** Erro com a forma de `MetaApiError` (o `httpStatus` é o que a rota lê). */
function erroDaMeta(httpStatus: number, message: string) {
  return Object.assign(new Error(message), { name: 'MetaApiError', httpStatus })
}

function bancoFalso(opcoes: {
  linhas?: Linha[]
  erroBusca?: ErroPg
  erroInsert?: ErroPg
  erroUpdate?: ErroPg
  /** Linha que OUTRA submissão grava no instante do INSERT desta (a corrida do 23505). */
  linhaQueVenceu?: Linha
}) {
  const completar = (l: Linha): Registro => ({
    account_id: 'acct-1',
    name: 'boas_vindas',
    language: 'pt_BR',
    status: l.meta_template_id ? 'APPROVED' : 'DRAFT',
    ...l,
  })
  const tabela: Registro[] = (opcoes.linhas ?? []).map(completar)
  const casa = (linha: Registro, filtros: Filtro[]) =>
    filtros.every(([, coluna, valor]) => linha[coluna] === valor)

  const buscas: Registro[] = []
  const updates: { filtros: Filtro[]; campos: Registro }[] = []
  const inserts: Registro[] = []

  const client = {
    from(nome: string) {
      expect(nome).toBe('message_templates')
      return {
        select() {
          const filtros: Filtro[] = []
          const registro: Registro = {}
          const consulta = {
            eq(coluna: string, valor: unknown) {
              filtros.push(['eq', coluna, valor])
              registro[coluna] = valor
              return consulta
            },
            async order() {
              buscas.push(registro)
              if (opcoes.erroBusca) return { data: null, error: opcoes.erroBusca }
              return {
                data: tabela.filter((l) => casa(l, filtros)).map((l) => ({ ...l })),
                error: null,
              }
            },
          }
          return consulta
        },
        update(campos: Registro) {
          const filtros: Filtro[] = []
          const executar = () => {
            updates.push({ filtros, campos })
            if (opcoes.erroUpdate) return { alvo: [] as Registro[], error: opcoes.erroUpdate }
            const alvo = tabela.filter((l) => casa(l, filtros))
            for (const l of alvo) Object.assign(l, campos)
            return { alvo, error: null }
          }
          const comando = {
            eq(coluna: string, valor: unknown) {
              filtros.push(['eq', coluna, valor])
              return comando
            },
            is(coluna: string, valor: unknown) {
              filtros.push(['is', coluna, valor])
              return comando
            },
            select() {
              return {
                // `.select().single()` — a gravação do aceite.
                async single() {
                  const { alvo, error } = executar()
                  if (error) return { data: null, error }
                  if (alvo.length !== 1) {
                    return {
                      data: null,
                      error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
                    }
                  }
                  return { data: { ...alvo[0] }, error: null }
                },
                // `await .select('id')` — a regravação do rascunho (lê o rowcount).
                then<T>(
                  resolver: (v: { data: Registro[] | null; error: ErroPg | null }) => T,
                ) {
                  const { alvo, error } = executar()
                  return Promise.resolve(
                    error
                      ? { data: null, error }
                      : { data: alvo.map((l) => ({ ...l })), error: null },
                  ).then(resolver)
                },
              }
            },
          }
          return comando
        },
        insert(linha: Registro) {
          inserts.push(linha)
          return {
            select: () => ({
              single: async () => {
                if (opcoes.erroInsert) {
                  if (opcoes.linhaQueVenceu) tabela.push(completar(opcoes.linhaQueVenceu))
                  return { data: null, error: opcoes.erroInsert }
                }
                const nova = { id: 'nova', ...linha }
                tabela.push(nova)
                return { data: nova, error: null }
              },
            }),
          }
        },
      }
    },
  }
  return { client, tabela, buscas, updates, inserts }
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

const RECUSA = 'Content in this language already exists'
const linhaDe = (banco: ReturnType<typeof bancoFalso>, id: string) =>
  banco.tabela.find((l) => l.id === id)

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

  it('modelo homônimo de OUTRA conta não é achado: nasce uma linha nova', async () => {
    const banco = bancoFalso({
      linhas: [
        { id: 'de-outra-conta', account_id: 'acct-2', channel_id: 'canal-1', meta_template_id: 'hsm-x' },
      ],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(1)
    expect(linhaDe(banco, 'de-outra-conta')?.meta_template_id).toBe('hsm-x')
  })
})

describe('templates/submit — a Meta recusou', () => {
  it('(ii) linha APROVADA vinculada à Meta: nada é gravado, e a resposta traz o erro e a dica', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-antigo' }],
    })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))

    const r = await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(0)
    expect(linhaDe(banco, 'aprovada')).toMatchObject({
      status: 'APPROVED',
      meta_template_id: 'hsm-antigo',
    })
    expect(r.init?.status).toBe(502)
    expect(r.body).toEqual({ error: RECUSA, code: 'modelo_ja_existe' })
  })

  it('linha vinculada e falha que NÃO é recusa (5xx, rede): nada é gravado e SEM a dica', async () => {
    for (const falha of [
      erroDaMeta(500, 'An unknown error has occurred.'),
      new Error('fetch failed'),
      new Error('Meta accepted the template but returned no id.'),
    ]) {
      const banco = bancoFalso({
        linhas: [{ id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-antigo' }],
      })
      submitMessageTemplate.mockRejectedValue(falha)

      const r = await enviar(banco)

      expect(banco.updates).toHaveLength(0)
      expect(banco.inserts).toHaveLength(0)
      expect(r.init?.status).toBe(502)
      expect(r.body).toEqual({ error: falha.message })
      vi.resetModules()
    }
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

  it('limite de taxa pelo STATUS HTTP, com a frase da Meta sem "429": é limite, sem a dica', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-antigo' }],
    })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(429, 'Too many calls'))

    const r = await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(r.init?.status).toBe(429)
    expect(r.body).not.toHaveProperty('code')
  })

  it('(iii) sem linha: insere o rascunho, com o autor e a conta', async () => {
    const banco = bancoFalso({})
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))

    const r = await enviar(banco)

    expect(r.init?.status).toBe(502)
    expect(r.body).toEqual({ error: RECUSA })
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

  it('(iv) rascunho local (sem meta_template_id): regrava AQUELA linha, cercado por "ainda sem id", sem trocar o autor', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'rascunho', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))

    await enviar(banco)

    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].filtros).toEqual([
      ['eq', 'id', 'rascunho'],
      ['is', 'meta_template_id', null],
    ])
    expect(banco.updates[0].campos).toMatchObject({
      status: 'DRAFT',
      meta_template_id: null,
      submission_error: RECUSA,
    })
    expect(banco.updates[0].campos).not.toHaveProperty('user_id')
    expect(linhaDe(banco, 'rascunho')).toMatchObject({ submission_error: RECUSA })
  })

  it('corrida: o rascunho é VINCULADO por outra submissão durante a chamada à Meta — a recusa desta não o rebaixa', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'r1', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockImplementation(async () => {
      // Enquanto esta chamada está na Meta, a outra aba (ou outro admin) foi
      // aceita e religou r1.
      Object.assign(linhaDe(banco, 'r1')!, {
        meta_template_id: 'hsm-da-outra',
        status: 'PENDING',
      })
      throw erroDaMeta(400, RECUSA)
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const r = await enviar(banco)

    expect(linhaDe(banco, 'r1')).toMatchObject({
      meta_template_id: 'hsm-da-outra',
      status: 'PENDING',
    })
    expect(banco.inserts).toHaveLength(0)
    expect(r.init?.status).toBe(502)
    expect(r.body).toEqual({ error: RECUSA, code: 'modelo_ja_existe' })
  })

  it('corrida com falha que não é recusa: a linha vinculada no meio também fica, e SEM a dica', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'r1', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockImplementation(async () => {
      Object.assign(linhaDe(banco, 'r1')!, { meta_template_id: 'hsm-da-outra' })
      throw erroDaMeta(503, 'Service temporarily unavailable')
    })

    const r = await enviar(banco)

    expect(linhaDe(banco, 'r1')?.meta_template_id).toBe('hsm-da-outra')
    expect(r.body).toEqual({ error: 'Service temporarily unavailable' })
  })

  it('corrida sem linha: outra submissão criou e vinculou o modelo (23505 no rascunho) — responde como linha vinculada', async () => {
    const banco = bancoFalso({
      erroInsert: { code: '23505', message: 'duplicate key value' },
      linhaQueVenceu: { id: 'venceu', channel_id: 'canal-1', meta_template_id: 'hsm-da-outra' },
    })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))

    const r = await enviar(banco)

    expect(banco.updates).toHaveLength(0)
    expect(linhaDe(banco, 'venceu')?.meta_template_id).toBe('hsm-da-outra')
    expect(r.body).toEqual({ error: RECUSA, code: 'modelo_ja_existe' })
  })

  it('(vii) falha ao gravar o rascunho vai para o log, e a resposta continua sendo a da Meta', async () => {
    const banco = bancoFalso({ erroInsert: { message: 'permission denied' } })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))
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
  it('(v) rascunho criado por OUTRO admin é achado pela conta: atualiza POR ID, não cria homônimo, e o autor fica', async () => {
    // A linha do colega: a busca não filtra por autor, então ela volta.
    const banco = bancoFalso({
      linhas: [{ id: 'do-colega', channel_id: 'canal-1', meta_template_id: null }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.body).toMatchObject({ success: true })
    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].filtros).toEqual([['eq', 'id', 'do-colega']])
    expect(banco.updates[0].campos).toMatchObject({
      meta_template_id: 'hsm-novo',
      status: 'PENDING',
      submission_error: null,
    })
    // Reatribuir o autor é decisão pendente (M24): o update não o toca.
    expect(banco.updates[0].campos).not.toHaveProperty('user_id')
    expect(linhaDe(banco, 'do-colega')?.meta_template_id).toBe('hsm-novo')
  })

  it('(vi) linha vinculada VELHA (a Meta aceitou de novo): religa com o id novo', async () => {
    const banco = bancoFalso({
      linhas: [{ id: 'velha', channel_id: 'canal-1', meta_template_id: 'hsm-apagado' }],
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    await enviar(banco)

    expect(banco.inserts).toHaveLength(0)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].filtros).toEqual([['eq', 'id', 'velha']])
    expect(linhaDe(banco, 'velha')?.meta_template_id).toBe('hsm-novo')
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
      linhaQueVenceu: { id: 'venceu', channel_id: 'canal-1', meta_template_id: null },
    })
    submitMessageTemplate.mockResolvedValue({ id: 'hsm-novo', status: 'PENDING' })

    const r = await enviar(banco)

    expect(r.body).toMatchObject({ success: true })
    expect(banco.buscas).toHaveLength(2)
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].filtros).toEqual([['eq', 'id', 'venceu']])
    expect(linhaDe(banco, 'venceu')?.meta_template_id).toBe('hsm-novo')
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

    expect(banco.updates.map((u) => u.filtros)).toEqual([[['eq', 'id', 'do-canal']]])
    expect(linhaDe(banco, 'global')?.meta_template_id).toBe('hsm-g')
  })

  it('no mesmo canal, prefere a vinculada à Meta ao homônimo que o bug antigo criou', async () => {
    const banco = bancoFalso({
      linhas: [
        { id: 'homonimo', channel_id: 'canal-1', meta_template_id: null },
        { id: 'aprovada', channel_id: 'canal-1', meta_template_id: 'hsm-1' },
      ],
    })
    submitMessageTemplate.mockRejectedValue(erroDaMeta(400, RECUSA))

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
    expect(linhaDe(banco, 'outro-numero')?.meta_template_id).toBe('hsm-2')
  })
})
