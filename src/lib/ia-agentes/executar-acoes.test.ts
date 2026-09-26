import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// EXECUTAR as ações do agente (F4, D28). O que estes testes seguram:
//  - contato, card e conversa são os DO TURNO; os ids, os da opção;
//  - tudo é conferido DE NOVO na hora: etapa que virou de ganho/perdido,
//    card que fechou ou é de outro contato, campo de data que passou a ser
//    vigiado, automação que ganhou passo fora da D5 — recusados;
//  - valor vazio não apaga campo;
//  - a tarefa é a MESMA inserção do motor, com o dono como autor e prazo hoje;
//  - a automação roda com o rótulo "ia:<agente>" e as guardas da rota manual;
//  - falha de uma ação não impede as outras; a feita deixa anotação.
// ============================================================

vi.mock('@/lib/automations/engine', () => ({
  criarTarefaComAviso: vi.fn(async () => ({ tarefaId: 'tarefa-1', avisou: true })),
  runAutomationById: vi.fn(async () => ({ ok: true, detail: 'ok' })),
  channelInScope: vi.fn(() => true),
  stageInScope: vi.fn(async () => true),
}))
vi.mock('@/lib/contacts/tag-events', () => ({
  addContactTagAndDispatch: vi.fn(async () => ({ added: true, dispatched: true })),
}))
vi.mock('@/lib/contacts/tag-write', () => ({ removeContactTag: vi.fn(async () => true) }))
vi.mock('./ferramentas', () => ({
  lerCamposVigiados: vi.fn(async () => new Set<string>()),
  motivosForaDaD5: vi.fn(async (_db: unknown, _conta: string, ids: string[]) => new Map(ids.map((id) => [id, null]))),
}))

import { channelInScope, criarTarefaComAviso, runAutomationById, stageInScope } from '@/lib/automations/engine'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'

import type { AcaoResolvida } from './acoes'
import { executarAcoes, type ContextoDasAcoes } from './executar-acoes'
import { lerCamposVigiados, motivosForaDaD5 } from './ferramentas'

type Linha = Record<string, unknown>

interface Banco {
  tabelas: Record<string, Linha[]>
  escritas: Array<{ tabela: string; op: string; valores: unknown; opcoes?: unknown }>
  consultas: Array<{ tabela: string; filtros: Array<[string, unknown]> }>
  rpcs: Array<{ nome: string; args: Record<string, unknown> }>
  respostaDaRpc: { data: unknown; error: { message: string } | null }
}

let banco: Banco

function valorEm(l: Linha, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Linha)[k] : undefined), l)
}

const db = {
  from(tabela: string) {
    const filtros: Array<[string, unknown]> = []
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => (filtros.push([c, v]), q),
      maybeSingle: async () => {
        banco.consultas.push({ tabela, filtros })
        const l = (banco.tabelas[tabela] ?? []).find((x) => filtros.every(([c, v]) => valorEm(x, c) === v))
        return { data: l ? { ...l } : null, error: null }
      },
      insert: async (valores: unknown) => {
        banco.escritas.push({ tabela, op: 'insert', valores })
        return { error: null }
      },
      upsert: async (valores: unknown, opcoes: unknown) => {
        banco.escritas.push({ tabela, op: 'upsert', valores, opcoes })
        return { error: null }
      },
    }
    return q
  },
  async rpc(nome: string, args: Record<string, unknown>) {
    banco.rpcs.push({ nome, args })
    return banco.respostaDaRpc
  },
} as unknown as SupabaseClient

const CTX: ContextoDasAcoes = {
  accountId: 'conta-1',
  conversationId: 'conv-1',
  contactId: 'contato-1',
  dealId: 'deal-1',
  canalId: 'canal-1',
  agente: { id: 'ag-1', nome: 'Triagem' },
  dono: 'dono-1',
}

const notas = () => banco.escritas.filter((e) => e.tabela === 'cb_conversation_notes').map((e) => e.valores as Linha)

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_APP_LOCALE', 'pt-BR')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  banco = {
    tabelas: {
      pipeline_stages: [
        { id: 'etapa-proposta', resultado: null, pipelines: { account_id: 'conta-1' } },
        { id: 'etapa-ganho', resultado: 'ganho', pipelines: { account_id: 'conta-1' } },
      ],
      deals: [{ id: 'deal-1', account_id: 'conta-1', contact_id: 'contato-1', status: 'open' }],
      custom_fields: [
        { id: 'campo-texto', account_id: 'conta-1', field_type: 'text' },
        { id: 'campo-data', account_id: 'conta-1', field_type: 'datetime' },
      ],
      automations: [
        { id: 'auto-1', account_id: 'conta-1', is_active: true, trigger_type: 'tag_added', name: 'Boas-vindas' },
        { id: 'auto-off', account_id: 'conta-1', is_active: false, trigger_type: 'tag_added', name: 'Off' },
      ],
    },
    escritas: [],
    consultas: [],
    rpcs: [],
    respostaDaRpc: { data: [{ ok: true, motivo: null, status_gravado: 'open' }], error: null },
  }
})

const acao = (a: Partial<AcaoResolvida> & Pick<AcaoResolvida, 'tipo' | 'id'>): AcaoResolvida => ({ nome: a.id, ...a })

describe('mover_etapa', () => {
  it('pela RPC do motor, no card do TURNO, com o status esperado; anota e avisa que moveu', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta', nome: 'Bancário · Proposta' })])
    expect(banco.rpcs).toEqual([
      {
        nome: 'cb_atualizar_negocio',
        args: {
          p_deal_id: 'deal-1',
          p_account_id: 'conta-1',
          p_pipeline_id: null,
          p_stage_id: 'etapa-proposta',
          p_status: null,
          p_cadeia: [],
          p_status_esperado: 'open',
        },
      },
    ])
    expect(r).toEqual({
      registros: [{ tipo: 'mover_etapa', alvo: { id: 'etapa-proposta', nome: 'Bancário · Proposta' }, ok: true }],
      moveu: true,
    })
    expect(notas()).toEqual([
      expect.objectContaining({
        account_id: 'conta-1',
        conversation_id: 'conv-1',
        contact_id: 'contato-1',
        author_user_id: null,
        autor_nome: 'IA · Triagem',
        texto: expect.stringContaining('Bancário · Proposta'),
      }),
    ])
    // O card é lido pela conta E pelo contato do turno.
    expect(banco.consultas.find((c) => c.tabela === 'deals')?.filtros).toEqual(
      expect.arrayContaining([
        ['account_id', 'conta-1'],
        ['id', 'deal-1'],
        ['contact_id', 'contato-1'],
      ]),
    )
  })

  it('⚠️ a etapa virou de ganho/perdido depois de liberada: recusada, sem mexer no card', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-ganho' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'etapa_de_resultado' })
    expect(r.moveu).toBe(false)
    expect(banco.rpcs).toEqual([])
    expect(notas()).toEqual([])
  })

  it('card fechado, de outro contato ou turno sem card: recusada', async () => {
    banco.tabelas.deals[0].status = 'lost'
    expect((await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])).registros[0]).toMatchObject({
      erro: 'card_fechado',
    })
    banco.tabelas.deals[0] = { ...banco.tabelas.deals[0], status: 'open', contact_id: 'outro' }
    expect((await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])).registros[0]).toMatchObject({
      erro: 'sem_card',
    })
    expect((await executarAcoes(db, { ...CTX, dealId: null }, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])).registros[0]).toMatchObject({
      erro: 'sem_card',
    })
    expect(banco.rpcs).toEqual([])
  })

  it('etapa de outra conta: recusada', async () => {
    banco.tabelas.pipeline_stages[0].pipelines = { account_id: 'conta-2' }
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'item_de_outra_conta' })
  })

  it('a RPC recusou (o card mudou de status no meio): falha com o motivo', async () => {
    banco.respostaDaRpc = { data: [{ ok: false, motivo: 'o negocio deixou de estar open' }], error: null }
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'recusado: o negocio deixou de estar open' })
    expect(r.moveu).toBe(false)
  })
})

describe('etiquetar / tirar_etiqueta', () => {
  it('pelo escritor central, com o contato, a conversa e a conexão do turno', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'etiquetar', id: 'tag-vip', nome: 'VIP' })])
    expect(addContactTagAndDispatch).toHaveBeenCalledWith({
      db,
      accountId: 'conta-1',
      contactId: 'contato-1',
      tagId: 'tag-vip',
      context: { conversation_id: 'conv-1', channel_id: 'canal-1' },
    })
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(notas()[0].texto).toContain('VIP')
  })

  it('a etiqueta já estava lá: ok, sem anotação', async () => {
    vi.mocked(addContactTagAndDispatch).mockResolvedValueOnce({ added: false, dispatched: false, reason: 'duplicate' })
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'etiquetar', id: 'tag-vip' })])
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(notas()).toEqual([])
  })

  it('tirar: pelo `removeContactTag`, com a conta', async () => {
    await executarAcoes(db, CTX, [acao({ tipo: 'tirar_etiqueta', id: 'tag-vip', nome: 'VIP' })])
    expect(removeContactTag).toHaveBeenCalledWith(db, { accountId: 'conta-1', contactId: 'contato-1', tagId: 'tag-vip' })
    expect(notas()[0].texto).toContain('VIP')
  })
})

describe('preencher_campo', () => {
  it('grava pelo upsert do motor, com a conta conferida no campo', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-texto', nome: 'Dívida', valor: 'R$ 150 mil' })])
    expect(banco.escritas.find((e) => e.tabela === 'contact_custom_values')).toEqual({
      tabela: 'contact_custom_values',
      op: 'upsert',
      valores: { contact_id: 'contato-1', custom_field_id: 'campo-texto', value: 'R$ 150 mil' },
      opcoes: { onConflict: 'contact_id,custom_field_id' },
    })
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(notas()[0].texto).toContain('R$ 150 mil')
  })

  it('⚠️ valor vazio NÃO apaga', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-texto', valor: '   ' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'valor_vazio' })
    expect(banco.escritas.filter((e) => e.tabela === 'contact_custom_values')).toEqual([])
  })

  it('⚠️ campo de data que passou a ser vigiado por lembrete: recusado de novo na hora', async () => {
    vi.mocked(lerCamposVigiados).mockResolvedValueOnce(new Set(['campo-data']))
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-data', valor: '2026-10-01T17:00:00Z' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'campo_vigiado' })
    expect(banco.escritas.filter((e) => e.tabela === 'contact_custom_values')).toEqual([])
  })

  it('campo de data NÃO vigiado grava o instante na forma canônica (a do motor)', async () => {
    await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-data', valor: '2026-10-01T14:00:00-03:00' })])
    const gravado = (banco.escritas.find((e) => e.tabela === 'contact_custom_values')?.valores as Linha).value
    expect(gravado).toMatch(/^2026-10-01T17:00:00/)
  })

  it('campo de outra conta: recusado', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-sumido', valor: 'x' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'item_de_outra_conta' })
  })
})

describe('criar_tarefa', () => {
  it('a MESMA inserção do motor: o membro da lista, o dono como autor, prazo HOJE, contato do turno', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'criar_tarefa', id: 'membro-ana', nome: 'Ana', valor: 'Ligar para a cliente' })])
    const args = vi.mocked(criarTarefaComAviso).mock.calls[0][1]
    expect(args).toMatchObject({
      accountId: 'conta-1',
      contactId: 'contato-1',
      autorId: 'dono-1',
      responsavelUserId: 'membro-ana',
      titulo: 'Ligar para a cliente',
      descricao: null,
      venceAs: null,
      importante: false,
    })
    expect(args.venceEm).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(args.tituloDoAviso).toContain('Triagem')
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(notas()[0].texto).toContain('Ligar para a cliente')
    expect(notas()[0].texto).toContain('Ana')
  })

  it('a inserção falhou (responsável saiu da conta): falha com o motivo, as outras seguem', async () => {
    vi.mocked(criarTarefaComAviso).mockRejectedValueOnce(new Error('create_task: responsável não é membro desta conta'))
    const r = await executarAcoes(db, CTX, [
      acao({ tipo: 'criar_tarefa', id: 'membro-saiu', valor: 'X' }),
      acao({ tipo: 'etiquetar', id: 'tag-vip' }),
    ])
    expect(r.registros.map((x) => x.ok)).toEqual([false, true])
    expect(r.registros[0].erro).toContain('responsável não é membro')
    expect(addContactTagAndDispatch).toHaveBeenCalled()
  })
})

describe('executar_automacao', () => {
  it('com o rótulo "ia:<agente>" e a conversa, o contato e a conexão do turno', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1', nome: 'Boas-vindas' })])
    expect(runAutomationById).toHaveBeenCalledWith({
      automationId: 'auto-1',
      accountId: 'conta-1',
      contactId: 'contato-1',
      context: { conversation_id: 'conv-1', channel_id: 'canal-1' },
      triggerType: 'tag_added',
      rotuloDoDisparo: 'ia:Triagem',
    })
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(notas()[0].texto).toContain('Boas-vindas')
  })

  it('⚠️ a D5 DE NOVO: a automação ganhou passo fora da D5 depois de liberada — não roda', async () => {
    vi.mocked(motivosForaDaD5).mockResolvedValueOnce(new Map([['auto-1', 'send_webhook']]))
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'automacao_fora_da_d5:send_webhook' })
    expect(runAutomationById).not.toHaveBeenCalled()
  })

  it('⚠️ a conferência da D5 que falha: não roda (na dúvida, a IA não dispara)', async () => {
    vi.mocked(motivosForaDaD5).mockRejectedValueOnce(new Error('banco fora'))
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])
    expect(r.registros[0]).toMatchObject({ ok: false })
    expect(runAutomationById).not.toHaveBeenCalled()
  })

  it('desligada, fora da conexão ou fora da etapa (as guardas da rota manual): não roda', async () => {
    expect((await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-off' })])).registros[0].erro).toBe(
      'automacao_desligada',
    )
    vi.mocked(channelInScope).mockReturnValueOnce(false)
    expect((await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])).registros[0].erro).toBe(
      'fora_da_conexao',
    )
    vi.mocked(stageInScope).mockResolvedValueOnce(false)
    expect((await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])).registros[0].erro).toBe(
      'fora_da_etapa',
    )
    expect(runAutomationById).not.toHaveBeenCalled()
  })

  it('o motor recusou: falha com o detalhe', async () => {
    vi.mocked(runAutomationById).mockResolvedValueOnce({ ok: false, detail: 'automação alvo está desativada' })
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'automação alvo está desativada' })
  })
})

describe('executarAcoes', () => {
  it('nenhuma ação: nada acontece', async () => {
    expect(await executarAcoes(db, CTX, [])).toEqual({ registros: [], moveu: false })
    expect(banco.escritas).toEqual([])
  })

  it('toda consulta leva a conta', async () => {
    await executarAcoes(db, CTX, [
      acao({ tipo: 'mover_etapa', id: 'etapa-proposta' }),
      acao({ tipo: 'preencher_campo', id: 'campo-texto', valor: 'x' }),
      acao({ tipo: 'executar_automacao', id: 'auto-1' }),
    ])
    for (const c of banco.consultas) {
      const conta = c.filtros.find(([k]) => k === 'account_id' || k === 'pipelines.account_id')
      expect(conta?.[1], c.tabela).toBe('conta-1')
    }
  })
})
