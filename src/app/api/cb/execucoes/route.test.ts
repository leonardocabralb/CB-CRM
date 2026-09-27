import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// GET /api/cb/execucoes — a linha do tempo da aba Automações descreve a
// condição por CAMPO PERSONALIZADO (2.10) pelo NOME do campo, lido pela
// CONTA de quem pergunta (sem a cerca, a rota seria um oráculo de nomes de
// campos de outras contas — a regra dos outros lookups desta rota).
// ============================================================

const CONTATO = '11111111-1111-4111-8111-111111111111'
const CAMPO = '22222222-2222-4222-8222-222222222222'

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: async () => ({ accountId: 'acc' }),
  toErrorResponse: (err: unknown) => new Response(String(err), { status: 500 }),
}))

const pedidos: Array<{ tabela: string; colunas: string; filtros: Array<[string, string, unknown]> }> = []

const RESPOSTAS: Record<string, unknown> = {
  automation_pending_executions: [
    {
      id: 'p1',
      automation_id: 'a1',
      run_at: '2026-09-27T12:00:00Z',
      next_step_position: 1,
      parent_step_id: null,
      branch: null,
      log_id: 'l1',
      automations: { name: 'Volta do desqualificado' },
    },
  ],
  automation_steps: [
    { id: 's0', automation_id: 'a1', parent_step_id: null, branch: null, step_type: 'wait', step_config: { amount: 1, unit: 'hours' }, position: 0 },
    {
      id: 's1',
      automation_id: 'a1',
      parent_step_id: null,
      branch: null,
      step_type: 'condition',
      step_config: { subject: 'custom_field', operand: CAMPO, operator: 'equals', value: 'Não respondeu' },
      position: 1,
    },
  ],
  automation_logs: [{ id: 'l1', steps_executed: [] }],
  custom_fields: [{ id: CAMPO, name: 'Motivo da desqualificação' }],
}

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(tabela: string) {
      const pedido = { tabela, colunas: '', filtros: [] as Array<[string, string, unknown]> }
      pedidos.push(pedido)
      const resp = () => Promise.resolve({ data: RESPOSTAS[tabela] ?? [], error: null })
      const b: Record<string, unknown> = {
        select: (c: string) => ((pedido.colunas = c), b),
        eq: (c: string, v: unknown) => (pedido.filtros.push(['eq', c, v]), b),
        in: (c: string, v: unknown) => (pedido.filtros.push(['in', c, v]), b),
        order: () => b,
        then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => resp().then(ok, falha),
      }
      return b
    },
  }),
}))

beforeEach(() => {
  pedidos.length = 0
})

describe('GET /api/cb/execucoes — condição por campo na linha do tempo', () => {
  it('descreve a condição pelo NOME do campo, lido pela CONTA', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request(`http://x/api/cb/execucoes?contactId=${CONTATO}`))
    const corpo = (await res.json()) as {
      grupos: Array<{ linha?: { proximos: Array<{ chave: string; valores: Record<string, unknown>; alvoSumiu: boolean }> } }>
    }
    const condicao = corpo.grupos[0]?.linha?.proximos.find((p) => p.chave.startsWith('condition'))
    expect(condicao).toEqual(
      expect.objectContaining({
        chave: 'condition_campo_equals',
        valores: { alvo: 'Motivo da desqualificação', valor: 'Não respondeu' },
        alvoSumiu: false,
      }),
    )
    const campos = pedidos.find((p) => p.tabela === 'custom_fields')
    expect(campos?.filtros).toContainEqual(['eq', 'account_id', 'acc'])
    expect(campos?.filtros).toContainEqual(['in', 'id', [CAMPO]])
    expect(campos?.colunas).toBe('id, name:field_name')
  })
})
