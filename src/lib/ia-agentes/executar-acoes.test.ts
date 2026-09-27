import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// EXECUTAR as ações do agente (F4, D28). O que estes testes seguram:
//  - contato, card e conversa são os DO TURNO; os ids, os da opção;
//  - tudo é conferido DE NOVO na hora: etapa que virou de ganho/perdido,
//    card que fechou ou é de outro contato, campo de data que passou a ser
//    vigiado, automação que ganhou passo fora da D5 — recusados, com o
//    CÓDIGO e o detalhe cru à parte; as automações da etapa e da etiqueta
//    NÃO são conferidas (a D5 vale só para o que o agente faz, 27/09/2026);
//  - valor vazio não apaga campo, e o valor tem de caber no formato do campo;
//  - a AÇÃO REPETIDA (o modelo re-emite as das respostas anteriores): mover
//    para a etapa em que o card JÁ está, etiqueta que já estava, etiqueta a
//    tirar que não estava e campo com o MESMO valor — ok com `ja_estava`,
//    sem escrita, sem anotação e sem dreno;
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
  motivosForaDaD5: vi.fn(async (_db: unknown, _conta: string, automacoes: string[]) => new Map(automacoes.map((id) => [id, null]))),
}))

// A agenda do Calendly (F5): o `POST /invitees` é um dublê (testado em `agenda.test.ts`).
vi.mock('./agenda', () => ({ marcarNoCalendly: vi.fn(async () => ({ ok: true, uri: 'https://api.calendly.com/x/I1' })) }))

import { channelInScope, criarTarefaComAviso, runAutomationById, stageInScope } from '@/lib/automations/engine'
import { addContactTagAndDispatch } from '@/lib/contacts/tag-events'
import { removeContactTag } from '@/lib/contacts/tag-write'

import { CODIGOS_DE_FALHA_DA_ACAO, type AcaoResolvida } from './acoes'
import { marcarNoCalendly } from './agenda'
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
      deals: [{ id: 'deal-1', account_id: 'conta-1', contact_id: 'contato-1', status: 'open', stage_id: 'etapa-lead' }],
      custom_fields: [
        { id: 'campo-texto', account_id: 'conta-1', field_type: 'text' },
        { id: 'campo-data', account_id: 'conta-1', field_type: 'datetime' },
        { id: 'campo-numero', account_id: 'conta-1', field_type: 'number' },
        { id: 'campo-lista', account_id: 'conta-1', field_type: 'select', field_options: { opcoes: ['Bancário', 'Trabalhista'] } },
        { id: 'campo-email', account_id: 'conta-1', field_type: 'text', espelho: 'contacts.email' },
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

  it('a RPC recusou (o card mudou de status no meio): `recusado`, com o motivo no detalhe', async () => {
    banco.respostaDaRpc = { data: [{ ok: false, motivo: 'o negocio deixou de estar open' }], error: null }
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'recusado', detalhe: 'o negocio deixou de estar open' })
    expect(r.moveu).toBe(false)
  })

  it('o card JÁ está na etapa: ok, `ja_estava`, sem RPC, sem anotação e sem dreno', async () => {
    banco.tabelas.deals[0].stage_id = 'etapa-proposta'
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta', nome: 'Proposta' })])
    expect(r).toEqual({
      registros: [{ tipo: 'mover_etapa', alvo: { id: 'etapa-proposta', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' }],
      moveu: false,
    })
    expect(banco.rpcs).toEqual([])
    expect(notas()).toEqual([])
  })

  it('⚠️ D5 só para o que o agente faz (27/09/2026): as automações da etapa NÃO são conferidas — move e drena', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'mover_etapa', id: 'etapa-proposta' })])
    expect(motivosForaDaD5).not.toHaveBeenCalled()
    expect(r.registros[0]).toMatchObject({ ok: true })
    expect(r.moveu).toBe(true)
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

  it('⚠️ a etiqueta já estava lá (a ação repetida): ok, `ja_estava`, sem anotação e sem `tag_added`', async () => {
    // O escritor central só dispara o `tag_added` para etiqueta NOVA (o UNIQUE recusa a repetida).
    vi.mocked(addContactTagAndDispatch).mockResolvedValueOnce({ added: false, dispatched: false, reason: 'duplicate' })
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'etiquetar', id: 'tag-vip', nome: 'VIP' })])
    expect(r.registros).toEqual([{ tipo: 'etiquetar', alvo: { id: 'tag-vip', nome: 'VIP' }, ok: true, detalhe: 'ja_estava' }])
    expect(notas()).toEqual([])
  })

  it('⚠️ D5 só para o que o agente faz (27/09/2026): as automações da etiqueta NÃO são conferidas', async () => {
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'etiquetar', id: 'tag-quente' })])
    expect(motivosForaDaD5).not.toHaveBeenCalled()
    expect(addContactTagAndDispatch).toHaveBeenCalled()
    expect(r.registros[0]).toMatchObject({ ok: true })
  })

  it('tirar: pelo `removeContactTag`, com a conta', async () => {
    await executarAcoes(db, CTX, [acao({ tipo: 'tirar_etiqueta', id: 'tag-vip', nome: 'VIP' })])
    expect(removeContactTag).toHaveBeenCalledWith(db, { accountId: 'conta-1', contactId: 'contato-1', tagId: 'tag-vip' })
    expect(notas()[0].texto).toContain('VIP')
  })

  it('⚠️ tirar a etiqueta que NÃO estava (a ação repetida): ok, `ja_estava`, sem anotação', async () => {
    vi.mocked(removeContactTag).mockResolvedValueOnce(false)
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'tirar_etiqueta', id: 'tag-vip', nome: 'VIP' })])
    expect(r.registros).toEqual([{ tipo: 'tirar_etiqueta', alvo: { id: 'tag-vip', nome: 'VIP' }, ok: true, detalhe: 'ja_estava' }])
    expect(notas()).toEqual([])
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

  it('⚠️ o MESMO valor que a ficha já tem (a ação repetida): ok, `ja_estava`, sem escrita e sem anotação', async () => {
    const daConta = { account_id: 'conta-1' }
    banco.tabelas.contact_custom_values = [
      { contact_id: 'contato-1', custom_field_id: 'campo-texto', value: ' r$ 150 MIL ', contacts: daConta },
      { contact_id: 'contato-1', custom_field_id: 'campo-data', value: '2026-10-01T14:00:00-03:00', contacts: daConta },
      // O mesmo valor, mas de OUTRO contato: não conta.
      { contact_id: 'outro', custom_field_id: 'campo-numero', value: '150000', contacts: daConta },
    ]
    const r = await executarAcoes(db, CTX, [
      acao({ tipo: 'preencher_campo', id: 'campo-texto', nome: 'Dívida', valor: 'R$ 150 mil' }),
      acao({ tipo: 'preencher_campo', id: 'campo-data', nome: 'Data', valor: '2026-10-01 14:00' }),
    ])
    expect(r.registros).toEqual([
      { tipo: 'preencher_campo', alvo: { id: 'campo-texto', nome: 'Dívida' }, ok: true, detalhe: 'ja_estava' },
      { tipo: 'preencher_campo', alvo: { id: 'campo-data', nome: 'Data' }, ok: true, detalhe: 'ja_estava' },
    ])
    expect(banco.escritas.filter((e) => e.tabela === 'contact_custom_values')).toEqual([])
    expect(notas()).toEqual([])
    // O valor é lido do contato DO TURNO, naquele campo, com a conta pelo contato.
    expect(banco.consultas.find((c) => c.tabela === 'contact_custom_values')?.filtros).toEqual([
      ['contacts.account_id', 'conta-1'],
      ['contact_id', 'contato-1'],
      ['custom_field_id', 'campo-texto'],
    ])

    // Valor DIFERENTE (ou o do outro contato): grava e anota.
    const r2 = await executarAcoes(db, CTX, [
      acao({ tipo: 'preencher_campo', id: 'campo-texto', valor: 'R$ 200 mil' }),
      acao({ tipo: 'preencher_campo', id: 'campo-numero', valor: '150000' }),
    ])
    expect(r2.registros.map((x) => [x.ok, x.detalhe])).toEqual([
      [true, undefined],
      [true, undefined],
    ])
    expect(banco.escritas.filter((e) => e.tabela === 'contact_custom_values')).toHaveLength(2)
    expect(notas()).toHaveLength(2)
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

  const gravado = () => (banco.escritas.find((e) => e.tabela === 'contact_custom_values')?.valores as Linha | undefined)?.value

  it('⚠️ data sem fuso: o dia (e a hora) no fuso do escritório; data ilegível: `valor_invalido`, nada gravado', async () => {
    await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-data', valor: '2026-10-01 14:00' })])
    expect(gravado()).toBe('2026-10-01T17:00:00.000Z')
    banco.escritas = []
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-data', valor: 'amanhã às 14h' })])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'valor_invalido', detalhe: 'data' })
    expect(gravado()).toBeUndefined()
  })

  it('número fora da forma, opção fora da lista, e-mail sem forma: `valor_invalido`', async () => {
    const r = await executarAcoes(db, CTX, [
      acao({ tipo: 'preencher_campo', id: 'campo-numero', valor: 'R$ 1.500' }),
      acao({ tipo: 'preencher_campo', id: 'campo-lista', valor: 'Previdenciário' }),
      acao({ tipo: 'preencher_campo', id: 'campo-email', valor: 'ana arroba x' }),
    ])
    expect(r.registros.map((x) => [x.erro, x.detalhe])).toEqual([
      ['valor_invalido', 'numero'],
      ['valor_invalido', 'lista'],
      ['valor_invalido', 'email'],
    ])
    expect(gravado()).toBeUndefined()
  })

  it('a opção da lista grava na grafia DELA; número e e-mail na forma certa gravam', async () => {
    await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-lista', valor: ' bancário ' })])
    expect(gravado()).toBe('Bancário')
    expect(notas()[0].texto).toContain('Bancário')
    banco.escritas = []
    await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-numero', valor: '150000.50' })])
    expect(gravado()).toBe('150000.50')
    banco.escritas = []
    await executarAcoes(db, CTX, [acao({ tipo: 'preencher_campo', id: 'campo-email', valor: 'ana@x.com' })])
    expect(gravado()).toBe('ana@x.com')
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
    expect(r.registros[0].erro).toBe('falhou')
    expect(r.registros[0].detalhe).toContain('responsável não é membro')
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

  it('⚠️ a D5 DE NOVO: a automação ganhou passo fora da D5 (ou "Aguardar") depois de liberada — não roda', async () => {
    vi.mocked(motivosForaDaD5).mockResolvedValueOnce(new Map([['auto-1', 'send_webhook']]))
    const r = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])
    expect(r.registros[0]).toEqual({
      tipo: 'executar_automacao',
      alvo: { id: 'auto-1', nome: 'auto-1' },
      ok: false,
      erro: 'automacao_fora_da_d5',
      detalhe: 'send_webhook',
    })
    expect(vi.mocked(motivosForaDaD5).mock.calls[0].slice(1)).toEqual(['conta-1', ['auto-1']])
    expect(runAutomationById).not.toHaveBeenCalled()

    vi.mocked(motivosForaDaD5).mockResolvedValueOnce(new Map([['auto-1', 'aguardar']]))
    const r2 = await executarAcoes(db, CTX, [acao({ tipo: 'executar_automacao', id: 'auto-1' })])
    expect(r2.registros[0]).toMatchObject({ erro: 'automacao_fora_da_d5', detalhe: 'aguardar' })
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
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'recusado', detalhe: 'automação alvo está desativada' })
  })
})

describe('executarAcoes', () => {
  it('⚠️ todo `erro` é um código da lista fechada (o texto cru vai no `detalhe`)', async () => {
    vi.mocked(criarTarefaComAviso).mockRejectedValueOnce(new Error('qualquer coisa'))
    banco.respostaDaRpc = { data: [{ ok: false, motivo: 'x' }], error: null }
    const r = await executarAcoes(db, CTX, [
      acao({ tipo: 'criar_tarefa', id: 'membro-ana', valor: 'X' }),
      acao({ tipo: 'mover_etapa', id: 'etapa-proposta' }),
      acao({ tipo: 'preencher_campo', id: 'campo-sumido', valor: 'x' }),
    ])
    for (const x of r.registros) expect(CODIGOS_DE_FALHA_DA_ACAO).toContain(x.erro)
  })

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
      const conta = c.filtros.find(([k]) => k === 'account_id' || k === 'pipelines.account_id' || k === 'contacts.account_id')
      expect(conta?.[1], c.tabela).toBe('conta-1')
    }
  })
})

// ------------------------------------------------------------
// MARCAR REUNIÃO (F5): por ÚLTIMO, no tipo de evento liberado e no horário
// da opção; sem régua da D5 (a automação do Calendly roda como quando o
// cliente agenda pelo link); a falha vira código.
// ------------------------------------------------------------

describe('marcar_reuniao (F5)', () => {
  const TIPO = 'https://api.calendly.com/event_types/T1'
  const H = '2026-09-28T18:15:00.000Z'
  const CTX_F5: ContextoDasAcoes = { ...CTX, tipoDeEvento: TIPO }
  const reuniao = acao({ tipo: 'marcar_reuniao', id: H, nome: 'Mon 28/09 15:15' })

  it('marca no tipo de evento liberado, no horário DA OPÇÃO, e anota a data no fuso do escritório', async () => {
    const r = await executarAcoes(db, CTX_F5, [reuniao])
    expect(marcarNoCalendly).toHaveBeenCalledWith(db, {
      accountId: 'conta-1',
      contactId: 'contato-1',
      tipoDeEvento: TIPO,
      inicio: H,
    })
    expect(r).toEqual({ registros: [{ tipo: 'marcar_reuniao', alvo: { id: H, nome: 'Mon 28/09 15:15' }, ok: true }], moveu: false })
    // Sem o nome no marcador: `marcarNoCalendly` usa o da ficha (o `nome` nem vai).
    expect(vi.mocked(marcarNoCalendly).mock.calls[0][1]).not.toHaveProperty('nome')
    expect(notas()).toEqual([
      expect.objectContaining({ autor_nome: 'IA · Triagem', texto: expect.stringContaining('28/09/2026 15:15') }),
    ])
    // A automação do tipo de evento roda pelo webhook: nada de `motivosForaDaD5`.
    expect(motivosForaDaD5).not.toHaveBeenCalled()
  })

  it('o nome SEM origem caiu na resolução: marca com o da ficha e o registro diz `nome_sem_origem`', async () => {
    const r = await executarAcoes(db, CTX_F5, [{ ...reuniao, nomeSemOrigem: true }])
    expect(vi.mocked(marcarNoCalendly).mock.calls[0][1]).not.toHaveProperty('nome')
    expect(r.registros).toEqual([
      { tipo: 'marcar_reuniao', alvo: { id: H, nome: 'Mon 28/09 15:15' }, ok: true, detalhe: 'nome_sem_origem' },
    ])
  })

  it('o nome completo do marcador (`[[REUNIAO:n=Nome]]`) vai ao Calendly', async () => {
    await executarAcoes(db, CTX_F5, [{ ...reuniao, valor: 'Maria Aparecida Souza' }])
    expect(vi.mocked(marcarNoCalendly).mock.calls[0][1]).toMatchObject({ inicio: H, nome: 'Maria Aparecida Souza' })
  })

  it('⚠️ roda por ÚLTIMO: o e-mail que o `preencher_campo` da mesma resposta grava já está lá', async () => {
    const ordem: string[] = []
    vi.mocked(marcarNoCalendly).mockImplementationOnce(async () => {
      ordem.push('reunião')
      return { ok: true, uri: null }
    })
    vi.mocked(addContactTagAndDispatch).mockImplementationOnce(async () => {
      ordem.push('etiqueta')
      return { added: true, dispatched: true }
    })
    const r = await executarAcoes(db, CTX_F5, [
      reuniao,
      acao({ tipo: 'preencher_campo', id: 'campo-email', valor: 'maria@exemplo.com' }),
      acao({ tipo: 'etiquetar', id: 'tag-vip' }),
    ])
    const upsert = banco.escritas.findIndex((e) => e.tabela === 'contact_custom_values')
    expect(upsert).toBeGreaterThanOrEqual(0)
    expect(ordem).toEqual(['etiqueta', 'reunião'])
    expect(r.registros.map((x) => x.tipo)).toEqual(['preencher_campo', 'etiquetar', 'marcar_reuniao'])
  })

  it('a falha vira o CÓDIGO da lista fechada, com o detalhe cru à parte, e sem anotação', async () => {
    vi.mocked(marcarNoCalendly).mockResolvedValueOnce({ ok: false, erro: 'horario_indisponivel', detalhe: '409: Conflict' })
    const r = await executarAcoes(db, CTX_F5, [reuniao])
    expect(r.registros[0]).toEqual({
      tipo: 'marcar_reuniao',
      alvo: { id: H, nome: 'Mon 28/09 15:15' },
      ok: false,
      erro: 'horario_indisponivel',
      detalhe: '409: Conflict',
    })
    expect(CODIGOS_DE_FALHA_DA_ACAO).toContain(r.registros[0].erro)
    expect(notas()).toEqual([])
  })

  it('sem e-mail: `sem_email`', async () => {
    vi.mocked(marcarNoCalendly).mockResolvedValueOnce({ ok: false, erro: 'sem_email' })
    expect((await executarAcoes(db, CTX_F5, [reuniao])).registros[0]).toMatchObject({ ok: false, erro: 'sem_email' })
  })

  it('turno sem tipo de evento liberado: recusada, sem chamar o Calendly', async () => {
    const r = await executarAcoes(db, CTX, [reuniao])
    expect(r.registros[0]).toMatchObject({ ok: false, erro: 'recusado' })
    expect(marcarNoCalendly).not.toHaveBeenCalled()
  })
})
