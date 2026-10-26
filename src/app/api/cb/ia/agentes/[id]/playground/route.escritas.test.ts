import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// O Playground NÃO MUDA DADO (a garantia do sandbox; DC4 da central dos
// agentes, 26/10/2026): em todo modo — a conversa com o agente salvo, com o
// RASCUNHO da tela, com "ver o pedido", com a passagem e as ações simuladas, e
// a retomada simulada —, a ÚNICA escrita no banco é a linha de custo em
// `ai_usage_log` (`agente_teste`, D13).
//
// O dublê do Supabase ANOTA toda escrita (insert, update, upsert, delete) e
// toda RPC. Ao contrário de `route.test.ts`, as leituras aqui são as REAIS
// (repo, acesso, base, ferramentas, agenda, `logAiUsage`): uma delas que
// passasse a escrever apareceria na lista. Só o provedor (falso), a sessão, o
// limite por minuto e as chaves (cifradas) são dublês. O pino estrutural é
// `src/lib/ia-agentes/sandbox-sem-efeito.test.ts`.
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'
const DESTINO = '22222222-2222-4222-8222-222222222222'
const CONTATO = '33333333-3333-4333-8333-333333333333'
const TAG = '44444444-4444-4444-8444-444444444444'
const TAG_DE_OUTRA_CONTA = '45454545-4545-4545-8545-454545454545'
const MEMBRO = '66666666-6666-4666-8666-666666666666'
const ETAPA = '77777777-7777-4777-8777-777777777777'

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'conta-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => new Response('erro', { status: 500 })),
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: vi.fn(),
  RATE_LIMITS: { aiDraft: {}, aiDraftAccount: {} },
}))
vi.mock('@/lib/ia-chaves/repo', () => ({
  lerChave: vi.fn(async () => ({ chave: 'chave-ficticia', ilegivel: false })),
  lerEstado: vi.fn(async () => [
    { provedor: 'anthropic', existe: true, soDaBase: false },
    { provedor: 'gemini', existe: true, soDaBase: false },
  ]),
  lerChaveDeEmbeddings: vi.fn(async () => ({ chave: null, ilegivel: false, recusada: false })),
}))

let resposta = { text: 'Olá!', handoff: false }
vi.mock('@/lib/ai/generate', () => ({
  generateReply: vi.fn(async () => ({
    ...resposta,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  })),
}))

// ------------------------------------------------------------
// O dublê: tabelas em memória, filtros eq/in/is aplicados (o resto da cadeia
// é aceito e ignorado), e TODA escrita e RPC anotadas.
// ------------------------------------------------------------
type Linha = Record<string, unknown>
const tabelas: Record<string, Linha[]> = {}
const escritas: Array<{ op: string; tabela: string; dados?: unknown }> = []
const rpcs: string[] = []

function consulta(tabela: string) {
  const filtros: Array<(l: Linha) => boolean> = []
  const linhas = () => (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)))
  const q: Record<string, unknown> = {}
  const cadeia = () => q
  for (const m of ['select', 'order', 'limit', 'range', 'not', 'or', 'gte', 'lte', 'gt', 'lt', 'neq', 'ilike', 'contains', 'filter', 'match']) {
    q[m] = cadeia
  }
  q.eq = (c: string, v: unknown) => {
    // Filtro sobre o embutido (`pipelines.account_id`) fica de fora: a linha do dublê já é da conta.
    if (!c.includes('.')) filtros.push((l) => l[c] === v)
    return q
  }
  q.in = (c: string, vs: unknown[]) => {
    if (!c.includes('.')) filtros.push((l) => vs.includes(l[c]))
    return q
  }
  q.is = (c: string, v: unknown) => {
    if (!c.includes('.')) filtros.push((l) => (v === null ? l[c] == null : l[c] === v))
    return q
  }
  q.maybeSingle = async () => ({ data: linhas()[0] ?? null, error: null })
  q.single = async () => {
    const [l] = linhas()
    return l ? { data: l, error: null } : { data: null, error: { code: 'PGRST116', message: 'nenhuma linha' } }
  }
  q.then = (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
    Promise.resolve({ data: linhas(), error: null, count: linhas().length }).then(ok, falha)
  const escrita = (op: string) => (dados?: unknown) => {
    escritas.push({ op, tabela, dados })
    return q
  }
  q.insert = escrita('insert')
  q.update = escrita('update')
  q.upsert = escrita('upsert')
  q.delete = escrita('delete')
  return q
}

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => consulta(tabela),
    rpc: async (nome: string) => {
      rpcs.push(nome)
      return { data: [], error: null }
    },
  }),
}))

import { POST } from './route'

function linhaDoAgente(id: string, extra: Linha = {}): Linha {
  return {
    id,
    account_id: 'conta-1',
    nome: id === ID ? 'Triagem de teste' : 'Cobrança de teste',
    descricao: 'agente fictício',
    instrucoes: 'Instrução salva.',
    regras: ['Regra salva.'],
    provedor: 'anthropic',
    modelo: 'modelo-ficticio',
    ativo: true,
    conexoes: [],
    horario: null,
    teto_respostas: 10,
    pode_passar_para: [],
    transferir_para: null,
    acesso: { ficha: true, campos: [], negocio: true, etiquetas: true, cobrancas: false, reuniao: false },
    ferramentas: {},
    retomada: { ativa: false, cadencia: [15, 60], janela: { inicio: '08:00', fim: '21:00' } },
    ativado_em: '2026-10-01T12:00:00Z',
    arquivado_em: null,
    created_at: '2026-10-01T12:00:00Z',
    updated_at: '2026-10-26T14:32:00Z',
    ...extra,
  }
}

function chamar(corpo: Record<string, unknown>) {
  return POST(
    new Request(`http://x/api/cb/ia/agentes/${ID}/playground`, { method: 'POST', body: JSON.stringify(corpo) }),
    { params: Promise.resolve({ id: ID }) },
  )
}

const CONVERSA = [{ role: 'user', content: 'Oi, quero saber do meu caso' }]
const SO_O_CUSTO = [{ op: 'insert', tabela: 'ai_usage_log' }]

beforeEach(() => {
  escritas.length = 0
  rpcs.length = 0
  for (const k of Object.keys(tabelas)) delete tabelas[k]
  tabelas.cb_ia_agentes = [
    linhaDoAgente(ID, {
      pode_passar_para: [DESTINO],
      ferramentas: { etiquetar: { etiquetas: [TAG] }, criar_tarefa: { membros: [MEMBRO] }, mover_etapa: { etapas: [ETAPA] } },
    }),
    linhaDoAgente(DESTINO),
  ]
  tabelas.contacts = [{ id: CONTATO, account_id: 'conta-1', name: 'Cliente Fictício', phone: '5500000000000' }]
  tabelas.tags = [
    { id: TAG, account_id: 'conta-1', name: 'Etiqueta fictícia' },
    { id: TAG_DE_OUTRA_CONTA, account_id: 'conta-2', name: 'De outra conta' },
  ]
  tabelas.profiles = [{ user_id: MEMBRO, account_id: 'conta-1', full_name: 'Membro Fictício', email: 'membro@exemplo.test' }]
  tabelas.pipeline_stages = [
    { id: ETAPA, name: 'Etapa fictícia', position: 1, resultado: null, pipelines: { account_id: 'conta-1', name: 'Funil' } },
  ]
  // Um documento marcado: a busca da base RODA (por palavras, sem chave de embeddings).
  tabelas.cb_ia_agente_documentos = [{ account_id: 'conta-1', ia_agente_id: ID, documento_id: 'doc-1' }]
  resposta = { text: 'Olá!', handoff: false }
})

/** As escritas sem os dados (a forma que o teste compara). */
const anotadas = () => escritas.map(({ op, tabela }) => ({ op, tabela }))

describe('o Playground não muda dado: a única escrita é o custo de TESTE', () => {
  it('a conversa com o agente salvo, com as ações e a passagem simuladas', async () => {
    resposta = { text: 'Vou anotar.\n[[ETIQUETAR:1]]\n[[TAREFA:1=Ligar amanhã]]\n[[MOVER:1]]', handoff: false }
    const res = await chamar({ messages: CONVERSA, contactId: CONTATO })
    expect(res.status).toBe(200)
    const corpo = await res.json()
    // As ações foram RESOLVIDAS (as leituras reais acharam os itens) — e só simuladas.
    expect(corpo.acoes.aceitas.map((a: { tipo: string }) => a.tipo)).toEqual(['etiquetar', 'criar_tarefa', 'mover_etapa'])
    expect(anotadas()).toEqual(SO_O_CUSTO)
    expect(escritas[0].dados).toMatchObject({ account_id: 'conta-1', mode: 'agente_teste', ia_agente_id: ID })
    // A base foi lida pela RPC de LEITURA (busca por palavras), e só ela.
    expect(rpcs).toEqual(['cb_ia_buscar_conhecimento_fts'])
  })

  it('a passagem para outro agente: nada move, nada anota', async () => {
    resposta = { text: '[[PASSAR:1]]\n[[ETIQUETAR:1]]', handoff: false }
    const corpo = await (await chamar({ messages: CONVERSA, contactId: CONTATO })).json()
    expect(corpo.passaPara).toBe('Cobrança de teste')
    expect(anotadas()).toEqual(SO_O_CUSTO)
  })

  it('a transferência para gente: nada pausa, nada anota', async () => {
    resposta = { text: '', handoff: true }
    const corpo = await (await chamar({ messages: CONVERSA })).json()
    expect(corpo.handoff).toBe(true)
    expect(anotadas()).toEqual(SO_O_CUSTO)
  })

  it('⚠️ com o RASCUNHO da tela (instruções, ferramentas, acesso, passagem, retomada) e "ver o pedido"', async () => {
    resposta = { text: 'Certo!\n[[ETIQUETAR:1]]', handoff: false }
    const res = await chamar({
      messages: CONVERSA,
      contactId: CONTATO,
      verPedido: true,
      rascunho: {
        instrucoes: 'Instrução do rascunho.',
        ferramentas: { etiquetar: { etiquetas: [TAG] } },
        acesso: { ficha: false, campos: [], negocio: false, etiquetas: false, cobrancas: false, reuniao: false },
        pode_passar_para: [DESTINO],
        retomada: { ativa: true, cadencia: [30], janela: { inicio: '08:00', fim: '21:00' } },
        ativo: false,
        etapas: [ETAPA],
      },
    })
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo.pedido).toContain('Instrução do rascunho.')
    expect(corpo.acoes.aceitas).toEqual([{ tipo: 'etiquetar', nome: 'Etiqueta fictícia' }])
    expect(anotadas()).toEqual(SO_O_CUSTO)
  })

  it('a retomada simulada, salva e do rascunho', async () => {
    resposta = { text: 'Oi! Conseguiu separar os documentos?', handoff: false }
    const conversa = [...CONVERSA, { role: 'assistant', content: 'Pode me mandar os documentos?' }]
    const salva = await chamar({ messages: conversa, retomada: true, contactId: CONTATO })
    expect(salva.status).toBe(200)
    const doRascunho = await chamar({
      messages: conversa,
      retomada: true,
      verPedido: true,
      rascunho: { retomada: { ativa: true, cadencia: [30, 120], janela: { inicio: '08:00', fim: '21:00' } } },
    })
    expect(doRascunho.status).toBe(200)
    expect(anotadas()).toEqual([...SO_O_CUSTO, ...SO_O_CUSTO])
  })

  it('⚠️ rascunho com item de OUTRA CONTA (a conferência REAL do salvar): 400 com o código e os ids — e nenhuma escrita, nem o custo', async () => {
    const res = await chamar({ messages: CONVERSA, rascunho: { ferramentas: { etiquetar: { etiquetas: [TAG_DE_OUTRA_CONTA] } } } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'item_de_outra_conta',
      code: 'item_de_outra_conta',
      itens: [TAG_DE_OUTRA_CONTA],
    })
    expect(escritas).toEqual([])
  })

  it('rascunho que troca para provedor sem chave: 400 `provedor_sem_chave`, nenhuma escrita', async () => {
    const res = await chamar({ messages: CONVERSA, rascunho: { provedor: 'openai', modelo: 'modelo-ficticio' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'provedor_sem_chave' })
    expect(escritas).toEqual([])
  })
})
