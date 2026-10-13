import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// As três escritas da rota de modelo filtram pela CONTA, não só pelo id
// (porte do #589 do original, 13/10/2026): segunda barreira atrás da leitura
// por conta e da RLS. Em arquivo próprio para o `route.test.ts` continuar
// igual ao do original (um merge futuro o traz sem conflito).
// ---------------------------------------------------------------------------

const ID = '3f1c9d2e-4b5a-4c6d-8e7f-0a1b2c3d4e5f'
const MODELO = {
  id: ID,
  name: 'aviso_de_pedido',
  status: 'APPROVED',
  meta_template_id: 'meta-1',
  language: 'pt_BR',
}

/** Os filtros (`.eq`) de cada escrita em `message_templates`. */
const filtrosDasEscritas: Array<Array<[string, unknown]>> = []
const patches: Record<string, unknown>[] = []

function dubleDoSupabase() {
  function tabela(nome: string) {
    const linha = () => {
      if (nome === 'profiles') {
        return { data: { account_id: 'conta-1', account_role: 'admin' }, error: null }
      }
      if (nome === 'message_templates') return { data: MODELO, error: null }
      if (nome === 'whatsapp_config') {
        return {
          data: {
            id: 'cfg-1',
            account_id: 'conta-1',
            phone_number_id: 'PNID-1',
            waba_id: 'WABA-1',
            access_token: 'token-cifrado',
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }
    const b: Record<string, unknown> = {}
    let escrita: Array<[string, unknown]> | null = null
    for (const m of ['select', 'in', 'order', 'limit']) b[m] = vi.fn(() => b)
    b.eq = vi.fn((coluna: string, valor: unknown) => {
      escrita?.push([coluna, valor])
      return b
    })
    b.update = vi.fn((patch: Record<string, unknown>) => {
      if (nome === 'message_templates') {
        patches.push(patch)
        escrita = []
        filtrosDasEscritas.push(escrita)
      }
      return b
    })
    b.delete = vi.fn(() => {
      if (nome === 'message_templates') {
        escrita = []
        filtrosDasEscritas.push(escrita)
      }
      return b
    })
    b.single = vi.fn(async () => linha())
    b.maybeSingle = vi.fn(async () => linha())
    b.then = (resolve: (v: unknown) => unknown) => resolve(linha())
    return b
  }
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'login-1' } }, error: null })),
    },
    from: vi.fn((nome: string) => tabela(nome)),
  }
}

let supabase = dubleDoSupabase()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabase),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn(() => 'token-claro'),
  encrypt: vi.fn(() => 'token-cifrado'),
  isLegacyFormat: vi.fn(() => false),
}))

const meta = vi.hoisted(() => ({
  editMessageTemplate: vi.fn(async () => ({})),
  deleteMessageTemplate: vi.fn(async () => ({})),
}))
vi.mock('@/lib/whatsapp/meta-api', () => meta)

vi.mock('@/lib/whatsapp/template-header-handle', () => ({
  ensureMediaHeaderHandle: vi.fn(async () => undefined),
}))

import { DELETE, PATCH } from './route'

const params = Promise.resolve({ id: ID })

function editar() {
  return PATCH(
    new Request(`http://localhost/api/whatsapp/templates/${ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'aviso_de_pedido',
        category: 'Marketing',
        language: 'pt_BR',
        body_text: 'Texto novo do modelo',
      }),
    }),
    { params },
  )
}

beforeEach(() => {
  filtrosDasEscritas.length = 0
  patches.length = 0
  supabase = dubleDoSupabase()
  meta.editMessageTemplate.mockClear()
  meta.deleteMessageTemplate.mockClear()
})

describe('escritas de message_templates levam a conta', () => {
  it('editar e apagar filtram por id E conta', async () => {
    expect((await editar()).status).toBe(200)
    expect((await DELETE(new Request('http://localhost/t'), { params })).status).toBe(200)

    expect(filtrosDasEscritas).toHaveLength(2)
    for (const filtros of filtrosDasEscritas) {
      expect(filtros).toContainEqual(['id', ID])
      expect(filtros).toContainEqual(['account_id', 'conta-1'])
    }
  })

  it('a falha da Meta grava o motivo filtrando pela conta', async () => {
    meta.editMessageTemplate.mockRejectedValueOnce(new Error('meta recusou'))

    expect((await editar()).status).toBe(502)

    expect(patches).toEqual([expect.objectContaining({ submission_error: 'meta recusou' })])
    expect(filtrosDasEscritas[0]).toContainEqual(['account_id', 'conta-1'])
  })
})
