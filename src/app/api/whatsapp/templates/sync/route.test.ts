import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// POST /api/whatsapp/templates/sync — o que a sincronização GRAVA.
//
// Dois defeitos (porte do #680 do original, D2 do plano de 17/11/2026):
//   - o UPDATE levava `user_id` de quem clicou: todo modelo do catálogo
//     passava a ser "de quem sincronizou" (o autor é de quem criou);
//   - a busca era `.or(canal, nulo).maybeSingle()`: com a linha do canal e a
//     global juntas, "várias linhas" e o modelo nunca mais sincronizava.
// O banco falso tem ESTADO e APLICA os filtros do UPDATE: gravar na linha
// errada, ou levar o autor junto, muda a tabela e reprova.
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

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v }))
vi.mock('@/lib/cb-channels/resolve-meta', () => ({
  resolveMetaChannel: vi.fn(async () => ({
    channelId: 'canal-1',
    label: 'Comercial',
    phoneNumberId: 'pn-1',
    accessToken: 'tok',
    wabaId: 'waba-1',
  })),
}))

type Registro = Record<string, unknown>

/** O modelo como a Meta o devolve na listagem da WABA. */
const DA_META = {
  id: 'meta-1',
  name: 'boas_vindas',
  language: 'pt_BR',
  status: 'APPROVED',
  category: 'UTILITY',
  components: [{ type: 'BODY', text: 'Olá {{1}}, tudo bem?' }],
}

function bancoFalso(opcoes: { linhas?: Registro[]; erroBusca?: { message: string } }) {
  const tabela: Registro[] = (opcoes.linhas ?? []).map((l) => ({
    account_id: 'acct-1',
    name: DA_META.name,
    language: DA_META.language,
    meta_template_id: null,
    ...l,
  }))
  const updates: { filtros: [string, unknown][]; campos: Registro }[] = []
  const inserts: Registro[] = []

  const client = {
    from(nome: string) {
      expect(nome).toBe('message_templates')
      return {
        select() {
          const filtros: [string, unknown][] = []
          const consulta = {
            eq(coluna: string, valor: unknown) {
              filtros.push([coluna, valor])
              return consulta
            },
            async order() {
              if (opcoes.erroBusca) return { data: null, error: opcoes.erroBusca }
              return {
                data: tabela
                  .filter((l) => filtros.every(([c, v]) => l[c] === v))
                  .map((l) => ({ ...l })),
                error: null,
              }
            },
          }
          return consulta
        },
        update(campos: Registro) {
          const filtros: [string, unknown][] = []
          const comando = {
            eq(coluna: string, valor: unknown) {
              filtros.push([coluna, valor])
              return comando
            },
            then(resolve: (v: unknown) => unknown) {
              updates.push({ filtros, campos })
              for (const l of tabela.filter((l) => filtros.every(([c, v]) => l[c] === v))) {
                Object.assign(l, campos)
              }
              return Promise.resolve(resolve({ data: null, error: null }))
            },
          }
          return comando
        },
        insert(linha: Registro) {
          inserts.push(linha)
          tabela.push({ id: `nova-${inserts.length}`, ...linha })
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  }
  return { client, tabela, updates, inserts }
}

let banco = bancoFalso({})

function respostaDaMeta(modelos: unknown[]) {
  return new Response(JSON.stringify({ data: modelos }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

import { POST } from './route'
import { __resetRateLimitForTests } from '@/lib/rate-limit'

async function sincronizar() {
  const res = (await POST(
    new Request('http://localhost/api/whatsapp/templates/sync'),
  )) as unknown as { body: Registro; init?: { status?: number } }
  return res.body
}

beforeEach(() => {
  __resetRateLimitForTests()
  banco = bancoFalso({})
  requireRole.mockImplementation(async () => ({
    supabase: banco.client,
    accountId: 'acct-1',
    userId: 'admin-que-clicou',
  }))
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respostaDaMeta([DA_META])),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a sincronização não troca o autor', () => {
  it('atualiza o modelo de outro autor e mantém o autor', async () => {
    banco = bancoFalso({
      linhas: [
        { id: 'l1', channel_id: 'canal-1', meta_template_id: 'meta-1', user_id: 'quem-criou' },
      ],
    })

    const corpo = await sincronizar()

    expect(corpo).toMatchObject({ success: true, inserted: 0, updated: 1, errors: [] })
    expect(banco.updates).toHaveLength(1)
    expect(banco.updates[0].campos).not.toHaveProperty('user_id')
    expect(banco.updates[0].campos).not.toHaveProperty('account_id')
    expect(banco.updates[0].filtros).toEqual([
      ['id', 'l1'],
      ['account_id', 'acct-1'],
    ])
    expect(banco.tabela[0]).toMatchObject({ user_id: 'quem-criou', status: 'APPROVED' })
  })

  it('modelo novo nasce com a conta, o canal e quem sincronizou como autor', async () => {
    const corpo = await sincronizar()

    expect(corpo).toMatchObject({ inserted: 1, updated: 0, errors: [] })
    expect(banco.inserts).toEqual([
      expect.objectContaining({
        account_id: 'acct-1',
        user_id: 'admin-que-clicou',
        channel_id: 'canal-1',
        name: 'boas_vindas',
        meta_template_id: 'meta-1',
      }),
    ])
  })
})

describe('a sincronização escolhe UMA linha', () => {
  it('com a do canal e a global juntas, atualiza a do canal, sem erro', async () => {
    banco = bancoFalso({
      linhas: [
        { id: 'global', channel_id: null, meta_template_id: 'meta-1', user_id: 'a' },
        { id: 'do-canal', channel_id: 'canal-1', user_id: 'b' },
      ],
    })

    const corpo = await sincronizar()

    expect(corpo).toMatchObject({ success: true, updated: 1, inserted: 0, errors: [] })
    expect(banco.updates.map((u) => u.filtros[0])).toEqual([['id', 'do-canal']])
  })

  it('só a global: o canal a adota, sem trocar o autor', async () => {
    banco = bancoFalso({ linhas: [{ id: 'global', channel_id: null, user_id: 'quem-criou' }] })

    await sincronizar()

    expect(banco.tabela[0]).toMatchObject({
      id: 'global',
      channel_id: 'canal-1',
      user_id: 'quem-criou',
      meta_template_id: 'meta-1',
    })
    expect(banco.inserts).toHaveLength(0)
  })

  it('a linha de OUTRO número não serve: nasce a deste', async () => {
    banco = bancoFalso({ linhas: [{ id: 'outro', channel_id: 'canal-2', user_id: 'x' }] })

    const corpo = await sincronizar()

    expect(corpo).toMatchObject({ inserted: 1, updated: 0 })
    expect(banco.updates).toHaveLength(0)
    expect(banco.tabela.find((l) => l.id === 'outro')).toMatchObject({ channel_id: 'canal-2' })
  })

  it('busca que falha vira erro daquele modelo, sem escrita', async () => {
    banco = bancoFalso({ erroBusca: { message: 'timeout' } })

    const corpo = await sincronizar()

    expect(corpo).toMatchObject({
      success: false,
      errors: [{ name: 'boas_vindas', language: 'pt_BR', message: 'timeout' }],
    })
    expect(banco.updates).toHaveLength(0)
    expect(banco.inserts).toHaveLength(0)
  })
})
