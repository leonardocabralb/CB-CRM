import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// PATCH/DELETE /api/quick-replies/[id] — a linha da CONTA e a linha VÁLIDA
// (porte do upstream #673).
//
// Antes, as duas respondiam `{ ok: true }` para a resposta rápida que não
// existe (ou é de outra conta), e o PATCH sem `kind` gravava a de texto com o
// texto vazio. Arquivo próprio, e não o `route.test.ts` do original: o dublê
// dele devolve o UPDATE SEM linhas, e a nossa rota confere as linhas do
// UPDATE (zero = 404) — contra ela, o teste dele reprovaria a edição válida.
// Num merge, o dele chega como arquivo novo: fica este.
// ============================================================

const ID = '3f2b8c1e-9a4d-4e2f-b6a1-0c9d8e7f6a5b'

const h = vi.hoisted(() => ({
  /** A linha gravada NA CONTA; `null` = não existe (ou é de outra conta). */
  row: null as Record<string, unknown> | null,
  erroDeLeitura: null as { message: string } | null,
  /** Linhas que o UPDATE/DELETE devolve; `undefined` = as da `row`. */
  linhasAfetadas: undefined as { id: string }[] | undefined,
  updates: [] as Record<string, unknown>[],
  deletes: 0,
  /** Os `.eq()` de cada consulta, na ordem em que foram montadas. */
  consultas: [] as { op: string; filtros: [string, unknown][] }[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({ accountId: 'acc-1', userId: 'user-1' })),
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth' }, { status: 403 })),
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const consulta = { op: 'select', filtros: [] as [string, unknown][] }
      h.consultas.push(consulta)
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (coluna: string, valor: unknown) => {
          consulta.filtros.push([coluna, valor])
          return builder
        },
        update: (patch: Record<string, unknown>) => {
          consulta.op = 'update'
          h.updates.push(patch)
          return builder
        },
        delete: () => {
          consulta.op = 'delete'
          h.deletes += 1
          return builder
        },
        maybeSingle: () =>
          Promise.resolve({
            data: h.erroDeLeitura ? null : h.row,
            error: h.erroDeLeitura,
          }),
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
          Promise.resolve({
            data: h.linhasAfetadas ?? (h.row ? [{ id: ID }] : []),
            error: null,
          }).then(ok, falha),
      }
      return builder
    },
  }),
}))

import { DELETE, PATCH } from './route'

const params = (id = ID) => ({ params: Promise.resolve({ id }) })

function patch(body: unknown, id = ID) {
  return PATCH(
    new Request(`http://localhost/api/quick-replies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(id),
  )
}

const apagar = (id = ID) => DELETE(new Request('http://localhost'), params(id))

const payloadValido = {
  kind: 'buttons',
  body: 'Escolha uma',
  buttons: [{ id: 'sim', title: 'Sim' }],
}

beforeEach(() => {
  h.row = { kind: 'text', content_text: 'Oi', interactive_payload: null }
  h.erroDeLeitura = null
  h.linhasAfetadas = undefined
  h.updates = []
  h.deletes = 0
  h.consultas = []
})

describe('PATCH /api/quick-replies/[id]', () => {
  it('404 para a resposta que não existe ou é de outra conta — e nada é gravado', async () => {
    h.row = null
    const res = await patch({ title: 'x' })
    expect(res.status).toBe(404)
    expect(h.updates).toHaveLength(0)
    // A leitura é pela CONTA: é ela que faz a de outra conta "não existir".
    expect(h.consultas[0].filtros).toEqual([
      ['id', ID],
      ['account_id', 'acc-1'],
    ])
  })

  it('404 para id que não é UUID, sem ir ao banco', async () => {
    const res = await patch({ title: 'x' }, 'nao-e-uuid')
    expect(res.status).toBe(404)
    expect(h.consultas).toHaveLength(0)
  })

  it('⚠️ leitura que falha é 500, nunca 404 (erro de banco não é "não encontrado")', async () => {
    h.erroDeLeitura = { message: 'timeout' }
    const res = await patch({ title: 'x' })
    expect(res.status).toBe(500)
    expect(h.updates).toHaveLength(0)
  })

  it('corpo que não é objeto é 400', async () => {
    const res = await patch(['title', 'x'])
    expect(res.status).toBe(400)
    expect(h.consultas).toHaveLength(0)
  })

  it('recusa esvaziar o texto da resposta de texto sem `kind` (vazio ou nulo)', async () => {
    for (const content_text of ['', '   ', null]) {
      const res = await patch({ content_text })
      expect(res.status).toBe(400)
    }
    expect(h.updates).toHaveLength(0)
  })

  it('recusa tirar o conteúdo da interativa sem `kind`', async () => {
    h.row = { kind: 'interactive', content_text: null, interactive_payload: payloadValido }
    const res = await patch({ interactive_payload: null })
    expect(res.status).toBe(400)
    expect(h.updates).toHaveLength(0)
  })

  it('grava a edição parcial válida, pela conta', async () => {
    const res = await patch({ content_text: 'Olá' })
    expect(res.status).toBe(200)
    expect(h.updates).toEqual([{ content_text: 'Olá' }])
    const escrita = h.consultas.find((c) => c.op === 'update')
    expect(escrita?.filtros).toEqual([
      ['id', ID],
      ['account_id', 'acc-1'],
    ])
  })

  it('só o título também passa, conferido contra a linha gravada', async () => {
    const res = await patch({ title: ' Horário ' })
    expect(res.status).toBe(200)
    expect(h.updates).toEqual([{ title: 'Horário' }])
  })

  it('⚠️ apagada entre a leitura e a escrita: o UPDATE sem linhas é 404, não "salvo"', async () => {
    h.linhasAfetadas = []
    const res = await patch({ content_text: 'Olá' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/quick-replies/[id]', () => {
  it('404 quando nada foi apagado', async () => {
    h.row = null
    const res = await apagar()
    expect(res.status).toBe(404)
  })

  it('200 quando a linha da conta foi apagada', async () => {
    const res = await apagar()
    expect(res.status).toBe(200)
    expect(h.deletes).toBe(1)
    expect(h.consultas[0].filtros).toEqual([
      ['id', ID],
      ['account_id', 'acc-1'],
    ])
  })

  it('404 para id que não é UUID, sem ir ao banco', async () => {
    const res = await apagar('nao-e-uuid')
    expect(res.status).toBe(404)
    expect(h.consultas).toHaveLength(0)
  })
})
