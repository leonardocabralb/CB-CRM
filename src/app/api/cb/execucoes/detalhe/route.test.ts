import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/cb/execucoes/detalhe — o registro de UMA execução encerrada, para
// a expansão do "Já rodou" (29/09/2026). Cada leitura cercada pela CONTA;
// leitura que falha é 500 (a tela diria "nada ficou para trás" sobre o que
// não conseguiu ler); o `context` da fila nunca vai para a resposta.
// ============================================================

const LOG = '11111111-1111-4111-8111-111111111111'
const ETIQUETA = '22222222-2222-4222-8222-222222222222'

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ accountId: 'acc' }),
  toErrorResponse: (err: unknown) => new Response(String(err), { status: 500 }),
}))

type Filtro = [string, string, unknown]
const h = vi.hoisted(() => ({
  pedidos: [] as Array<{ tabela: string; colunas: string; filtros: Filtro[] }>,
  respostas: {} as Record<string, unknown>,
  erros: {} as Record<string, { message: string } | undefined>,
  escritas: 0,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      const pedido = { tabela, colunas: '', filtros: [] as Filtro[] }
      h.pedidos.push(pedido)
      const erro = h.erros[tabela]
      const lista = () =>
        Promise.resolve(erro ? { data: null, error: erro } : { data: h.respostas[tabela] ?? [], error: null })
      const b: Record<string, unknown> = {
        select: (c: string) => ((pedido.colunas = c), b),
        eq: (c: string, v: unknown) => (pedido.filtros.push(['eq', c, v]), b),
        in: (c: string, v: unknown) => (pedido.filtros.push(['in', c, v]), b),
        update: () => ((h.escritas += 1), b),
        insert: () => ((h.escritas += 1), b),
        delete: () => ((h.escritas += 1), b),
        maybeSingle: async () => {
          if (erro) return { data: null, error: erro }
          const linhas = (h.respostas[tabela] ?? []) as Record<string, unknown>[]
          const conta = pedido.filtros.find(([, c]) => c === 'account_id')?.[2]
          return { data: linhas.find((l) => l.account_id === conta) ?? null, error: null }
        },
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => lista().then(ok, falha),
      }
      return b
    },
  }),
}))

import { GET } from './route'

const pedir = (log: string) => GET(new Request(`http://x/api/cb/execucoes/detalhe?log=${log}`))

beforeEach(() => {
  h.pedidos = []
  h.erros = {}
  h.escritas = 0
  h.respostas = {
    automation_logs: [
      {
        account_id: 'acc',
        id: LOG,
        automation_id: 'aut',
        trigger_event: 'deal_stage_changed',
        created_at: '2026-09-29T13:41:07Z',
        finalizado_em: '2026-09-29T13:42:16Z',
        desfecho: 'falhou',
        error_message: 'webhook returned 404',
        steps_executed: [
          { step_id: 's0', step_type: 'add_tag', status: 'success', detail: `tag ${ETIQUETA} already present` },
          { step_id: 's1', step_type: 'send_webhook', status: 'failed', detail: 'webhook returned 404' },
        ],
        interrompida_em: null,
        interrompida_por: null,
        automations: { name: 'Contrato fechado' },
      },
    ],
    automation_steps: [
      { id: 's0', parent_step_id: null, branch: null, step_type: 'add_tag', step_config: { tag_id: ETIQUETA }, position: 0 },
      { id: 's1', parent_step_id: null, branch: null, step_type: 'send_webhook', step_config: {}, position: 1 },
      { id: 's2', parent_step_id: null, branch: null, step_type: 'send_message', step_config: { text: 'oi' }, position: 2 },
    ],
    automation_pending_executions: [],
    tags: [{ id: ETIQUETA, name: 'Cliente' }],
  }
})

describe('GET /api/cb/execucoes/detalhe', () => {
  it('devolve o que rodou, onde parou e o que não rodou', async () => {
    const res = await pedir(LOG)
    expect(res.status).toBe(200)
    const corpo = await res.json()
    expect(corpo.execucao).toMatchObject({
      nome: 'Contrato fechado',
      gatilho: 'deal_stage_changed',
      desfecho: 'falhou',
      erro: 'webhook returned 404',
      terminadaEm: '2026-09-29T13:42:16Z',
    })
    expect(corpo.detalhe.passos.map((p: { estado: string }) => p.estado)).toEqual(['feito', 'falhou'])
    expect(corpo.detalhe.passos[1].parou).toBe(true)
    expect(corpo.detalhe.naoRodaram.map((p: { id: string }) => p.id)).toEqual(['s2'])
    // O nome da etiqueta, para o rótulo do passo E para o texto do motor.
    expect(corpo.detalhe.passos[0].valores.alvo).toBe('Cliente')
    expect(corpo.nomesDoTexto.porId[ETIQUETA]).toBe('Cliente')
    expect(corpo.nomesDoTexto.carregados).toContain('etiqueta')
  })

  it('cada leitura é cercada pela conta — o registro, a fila e os nomes', async () => {
    await pedir(LOG)
    const cercada = (tabela: string) =>
      h.pedidos
        .filter((p) => p.tabela === tabela)
        .every((p) => p.filtros.some(([, c, v]) => (c === 'account_id' || c === 'pipelines.account_id') && v === 'acc'))
    for (const tabela of ['automation_logs', 'automation_pending_executions', 'tags']) {
      expect(cercada(tabela), tabela).toBe(true)
    }
  })

  it('a fila só é lida nas esperas ENCERRADAS desta execução, e o context não vai para a resposta', async () => {
    h.respostas.automation_logs = [
      {
        ...(h.respostas.automation_logs as Record<string, unknown>[])[0],
        desfecho: null,
        finalizado_em: null,
        error_message: null,
        steps_executed: [{ step_id: 's0', step_type: 'add_tag', status: 'success', detail: 'x' }],
        interrompida_em: '2026-09-29T14:00:00Z',
        interrompida_por: 'resposta',
      },
    ]
    h.respostas.automation_pending_executions = [
      { parent_step_id: null, branch: null, next_step_position: 1, context: { segredo: 'senha', _passo_da_fila: { id: 's0', pos: 0 } } },
    ]
    const corpo = await (await pedir(LOG)).json()
    expect(corpo.execucao).toMatchObject({ desfecho: 'interrompida', interrompidaPor: 'resposta' })
    expect(corpo.detalhe.naoRodaram.map((p: { id: string }) => p.id)).toEqual(['s1', 's2'])
    expect(JSON.stringify(corpo)).not.toContain('senha')
    const fila = h.pedidos.find((p) => p.tabela === 'automation_pending_executions')
    expect(fila?.filtros).toContainEqual(['eq', 'log_id', LOG])
    expect(fila?.filtros).toContainEqual(['in', 'status', ['cancelled', 'failed']])
  })

  it('registro de OUTRA conta é 404', async () => {
    h.respostas.automation_logs = [
      { ...(h.respostas.automation_logs as Record<string, unknown>[])[0], account_id: 'outra' },
    ]
    expect((await pedir(LOG)).status).toBe(404)
  })

  it('execução ainda em curso não tem detalhe de encerrada (409)', async () => {
    h.respostas.automation_logs = [
      { ...(h.respostas.automation_logs as Record<string, unknown>[])[0], desfecho: null, finalizado_em: null },
    ]
    expect((await pedir(LOG)).status).toBe(409)
  })

  it('leitura que falha é 500 — do registro, do plano ou da fila', async () => {
    for (const tabela of ['automation_logs', 'automation_steps', 'automation_pending_executions']) {
      h.erros = { [tabela]: { message: 'fora do ar' } }
      expect((await pedir(LOG)).status, tabela).toBe(500)
    }
  })

  it('nome que não carregou não vira "(apagada)": o catálogo fica fora de `carregados`', async () => {
    h.erros = { tags: { message: 'fora do ar' } }
    const corpo = await (await pedir(LOG)).json()
    expect(corpo.nomesDoTexto.carregados).not.toContain('etiqueta')
  })

  it('id que não é UUID é 400', async () => {
    expect((await pedir('abc')).status).toBe(400)
  })

  it('só lê', async () => {
    await pedir(LOG)
    expect(h.escritas).toBe(0)
  })
})
