import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Salvar o robô troca os nós NUMA TRANSAÇÃO (1104). Até aqui a rota apagava
// todos os nós e inseria os novos em duas idas ao banco: com o INSERT
// recusado (tipo fora do CHECK de `node_type`, chave repetida), o robô ficava
// SEM NÓ NENHUM. O "banco" deste teste imita a função `cb_trocar_nos_do_robo`
// como a migration a prova num Postgres de verdade: ou troca tudo, ou não toca
// em nada.
// ============================================================

type No = Record<string, unknown>

const TIPOS_DO_CHECK = new Set([
  'start', 'send_buttons', 'send_list', 'send_message', 'send_media', 'collect_input',
  'condition', 'set_tag', 'move_deal_stage', 'handoff', 'http_fetch', 'end',
])

const h = vi.hoisted(() => ({
  papel: 'admin',
  donoVe: true,
  canalExiste: true,
  ordem: [] as string[],
  rpcs: [] as { nome: string; args: Record<string, unknown> }[],
  patches: [] as Record<string, unknown>[],
  escritasDiretasNosNos: [] as string[],
  flow: {} as Record<string, unknown>,
  nos: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => {
    h.ordem.push('papel')
    if (h.papel !== 'admin') throw new Error('forbidden')
    return { accountId: 'acct-1', userId: 'u-1', role: h.papel }
  }),
  toErrorResponse: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u-1' } } }) },
    // A guarda de posse (o robô visível pela RLS de quem pediu) e a conexão
    // do cabeçalho, pela mesma sessão.
    from: (tabela: string) => {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (tabela === 'cb_channels') {
            h.ordem.push('canal')
            return { data: h.canalExiste ? { id: 'canal-1' } : null, error: null }
          }
          h.ordem.push('posse')
          return { data: h.donoVe ? { id: 'robo-1' } : null, error: null }
        },
      }
      return b
    },
  }),
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    rpc: async (nome: string, args: Record<string, unknown>) => {
      h.ordem.push(`rpc:${nome}`)
      h.rpcs.push({ nome, args })
      const nos = args.p_nodes as No[]
      // O que a função faz no banco: recusa → nada muda; senão troca tudo.
      const recusado = nos.find((n) => !TIPOS_DO_CHECK.has(String(n.node_type)))
      if (recusado) {
        return {
          data: null,
          error: { message: 'new row for relation "flow_nodes" violates check constraint "flow_nodes_node_type_check"' },
        }
      }
      h.nos = nos.map((n, i) => ({ id: `novo-${i}`, flow_id: args.p_flow_id, ...n }))
      return { data: nos.length, error: null }
    },
    from: (tabela: string) => {
      let op = 'select'
      let payload: Record<string, unknown> | null = null
      const b: Record<string, unknown> = {
        select: () => b,
        update: (p: Record<string, unknown>) => ((op = 'update'), (payload = p), b),
        delete: () => (h.escritasDiretasNosNos.push(`${tabela}:delete`), (op = 'delete'), b),
        insert: () => (h.escritasDiretasNosNos.push(`${tabela}:insert`), (op = 'insert'), b),
        order: () => b,
        eq: () => b,
        maybeSingle: async () => ({ data: tabela === 'flows' ? h.flow : null, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (tabela === 'flows' && op === 'update' && payload) {
            h.ordem.push('cabecalho')
            h.patches.push(payload)
            Object.assign(h.flow, payload)
            return Promise.resolve({ error: null }).then(ok)
          }
          if (tabela === 'flow_nodes') return Promise.resolve({ data: h.nos, error: null }).then(ok)
          return Promise.resolve({ data: null, error: null }).then(ok)
        },
      }
      return b
    },
  }),
}))

import { PUT } from './route'

const NOS_DE_ANTES = [
  { id: 'n1', flow_id: 'robo-1', node_key: 'inicio', node_type: 'start', config: { next_node_key: 'fim' }, position_x: 0, position_y: 0 },
  { id: 'n2', flow_id: 'robo-1', node_key: 'fim', node_type: 'end', config: {}, position_x: 240, position_y: 0 },
]

function pedido(corpo: unknown): Request {
  return { json: async () => corpo } as unknown as Request
}
const contexto = { params: Promise.resolve({ id: 'robo-1' }) }

async function salvar(corpo: unknown) {
  const r = (await PUT(pedido(corpo), contexto)) as Response
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> }
}

beforeEach(() => {
  h.papel = 'admin'
  h.donoVe = true
  h.canalExiste = true
  h.ordem = []
  h.rpcs = []
  h.patches = []
  h.escritasDiretasNosNos = []
  h.flow = { id: 'robo-1', name: 'Robô', entry_node_id: 'inicio', status: 'active' }
  h.nos = NOS_DE_ANTES.map((n) => ({ ...n }))
})

describe('PUT /api/flows/[id] — os nós numa transação (1104)', () => {
  it('troca os nós pela RPC (service role), depois das guardas e ANTES do cabeçalho; responde { flow, nodes }', async () => {
    const r = await salvar({
      name: 'Robô novo',
      entry_node_id: 'menu',
      nodes: [
        { node_key: 'menu', node_type: 'send_buttons', config: { text: 'Escolha' }, position_x: 10, position_y: 20 },
        { node_key: 'fim', node_type: 'end', config: {} },
      ],
    })

    expect(r.status).toBe(200)
    expect(h.rpcs).toEqual([
      {
        nome: 'cb_trocar_nos_do_robo',
        args: {
          p_flow_id: 'robo-1',
          p_nodes: [
            { node_key: 'menu', node_type: 'send_buttons', config: { text: 'Escolha' }, position_x: 10, position_y: 20 },
            // Posição ausente vai 0, como o INSERT de antes.
            { node_key: 'fim', node_type: 'end', config: {}, position_x: 0, position_y: 0 },
          ],
        },
      },
    ])
    expect(h.ordem).toEqual(['papel', 'posse', 'rpc:cb_trocar_nos_do_robo', 'cabecalho'])
    // Nada de apagar e inserir direto na tabela: a troca é da função.
    expect(h.escritasDiretasNosNos).toEqual([])
    expect(r.corpo.flow).toMatchObject({ name: 'Robô novo', entry_node_id: 'menu' })
    expect((r.corpo.nodes as No[]).map((n) => n.node_key)).toEqual(['menu', 'fim'])
  })

  it('⚠️⚠️ a troca RECUSADA (tipo fora do CHECK): 500 com o motivo, e o robô fica como estava — nós E cabeçalho', async () => {
    const r = await salvar({
      name: 'Robô novo',
      entry_node_id: 'novo',
      nodes: [
        { node_key: 'novo', node_type: 'tipo_que_o_banco_nao_conhece', config: {} },
        { node_key: 'fim', node_type: 'end', config: {} },
      ],
    })

    expect(r.status).toBe(500)
    expect(r.corpo.error).toMatch(/flow_nodes_node_type_check/)
    // Os nós de antes, intactos (antes desta entrega: nenhum nó).
    expect(h.nos).toEqual(NOS_DE_ANTES)
    // O cabeçalho não foi gravado: o `entry_node_id` não aponta para um nó que não existe.
    expect(h.patches).toEqual([])
    expect(h.flow).toMatchObject({ name: 'Robô', entry_node_id: 'inicio' })
    expect(h.escritasDiretasNosNos).toEqual([])
  })

  it('conexão do cabeçalho conferida ANTES da troca: a que sumiu é 400 e o robô fica como estava', async () => {
    // O editor aberto de um robô cuja conexão foi apagada manda o id velho; o
    // UPDATE do cabeçalho estouraria DEPOIS da troca dos nós.
    h.canalExiste = false
    const r = await salvar({
      channel_id: 'canal-apagado',
      entry_node_id: 'novo',
      nodes: [{ node_key: 'novo', node_type: 'start', config: {} }],
    })

    expect(r.status).toBe(400)
    expect(h.ordem).toEqual(['papel', 'posse', 'canal'])
    expect(h.rpcs).toEqual([])
    expect(h.patches).toEqual([])
    expect(h.nos).toEqual(NOS_DE_ANTES)
  })

  it('conexão que existe: confere, troca e grava o cabeçalho', async () => {
    const r = await salvar({ channel_id: 'canal-1', nodes: [{ node_key: 'fim', node_type: 'end', config: {} }] })

    expect(r.status).toBe(200)
    expect(h.ordem).toEqual(['papel', 'posse', 'canal', 'rpc:cb_trocar_nos_do_robo', 'cabecalho'])
    expect(h.patches[0]).toMatchObject({ channel_id: 'canal-1' })
  })

  it('salvar só o cabeçalho (sem `nodes`) não chama a troca', async () => {
    const r = await salvar({ name: 'Só o nome' })

    expect(r.status).toBe(200)
    expect(h.rpcs).toEqual([])
    expect(h.patches).toHaveLength(1)
    expect(h.nos).toEqual(NOS_DE_ANTES)
  })

  it('lista vazia de nós é troca legítima (o robô fica sem nó, como antes)', async () => {
    await salvar({ nodes: [] })
    expect(h.rpcs).toEqual([{ nome: 'cb_trocar_nos_do_robo', args: { p_flow_id: 'robo-1', p_nodes: [] } }])
    expect(h.nos).toEqual([])
  })

  it('as guardas vêm antes: sem papel ou sem enxergar o robô, nada é trocado', async () => {
    h.papel = 'agent'
    expect((await salvar({ nodes: [] })).status).toBe(403)
    h.papel = 'admin'
    h.donoVe = false
    expect((await salvar({ nodes: [] })).status).toBe(404)
    expect(h.rpcs).toEqual([])
    expect(h.nos).toEqual(NOS_DE_ANTES)
  })
})

describe('o fonte da rota', () => {
  // Um merge do upstream que traga de volta o apagar-e-inserir cru não
  // conflita com nada — e devolve o robô sem nó na primeira recusa.
  const fonte = readFileSync(join(process.cwd(), 'src/app/api/flows/[id]/route.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')

  it('não escreve em flow_nodes direto — só pela função', () => {
    expect(fonte).toMatch(/\.rpc\('cb_trocar_nos_do_robo'/)
    expect(fonte).not.toMatch(/from\('flow_nodes'\)\s*\.(delete|insert|upsert)\(/)
  })
})
