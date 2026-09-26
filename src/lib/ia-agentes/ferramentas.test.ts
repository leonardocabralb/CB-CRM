import type { SupabaseClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { conferirFerramentas, lerCatalogoDeFerramentas, motivosForaDaD5, opcoesDoAgente } from './ferramentas'

// ============================================================
// As FERRAMENTAS no banco (F4, D28). O banco é FALSO, em memória, e imita do
// PostgREST só o que o módulo usa: `eq`/`in`/`not is null` (inclusive no
// embutido, `pipelines.account_id`), `order`, `range`. O que estes testes
// seguram:
//  - todo item liberado é DESTA conta (etapa pelo funil, passo pela
//    automação) — o de outra conta é recusado com o id;
//  - a D5 ao salvar: etapa de ganho/perdido, campo de data vigiado por
//    lembrete ligado, automação com passo fora da D5 (atravessando as que ela
//    aciona, com trava de ciclo);
//  - as opções do pedido: só o que existe na conta e pode ser feito agora,
//    com os nomes; leitura que falha tira o tipo, nunca derruba.
// ============================================================

type Linha = Record<string, unknown>

function valorEm(l: Linha, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Linha)[k] : undefined), l)
}

interface Banco {
  tabelas: Record<string, Linha[]>
  falhas: Set<string>
  consultas: Array<{ tabela: string; filtros: Array<[string, string, unknown]> }>
}

function criarBanco(tabelas: Record<string, Linha[]>): { banco: Banco; db: SupabaseClient } {
  const banco: Banco = { tabelas, falhas: new Set(), consultas: [] }
  const db = {
    from(tabela: string) {
      const filtros: Array<[string, string, unknown]> = []
      let faixa: [number, number] | null = null
      const executar = async () => {
        banco.consultas.push({ tabela, filtros })
        if (banco.falhas.has(tabela)) return { data: null, error: { message: `${tabela} fora do ar` } }
        let linhas = (banco.tabelas[tabela] ?? []).filter((l) =>
          filtros.every(([op, c, v]) => {
            const x = valorEm(l, c)
            if (op === 'eq') return x === v
            if (op === 'in') return (v as unknown[]).includes(x)
            if (op === 'notnull') return x !== null && x !== undefined
            return true
          }),
        )
        if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1)
        return { data: linhas.map((l) => ({ ...l })), error: null }
      }
      const q = {
        select: () => q,
        order: () => q,
        eq: (c: string, v: unknown) => (filtros.push(['eq', c, v]), q),
        in: (c: string, v: unknown[]) => (filtros.push(['in', c, v]), q),
        not: (c: string) => (filtros.push(['notnull', c, null]), q),
        range: (de: number, ate: number) => ((faixa = [de, ate]), q),
        then: (ok: (r: unknown) => unknown, erro: (e: unknown) => unknown) => executar().then(ok, erro),
      }
      return q
    },
  } as unknown as SupabaseClient
  return { banco, db }
}

const CONTA = 'conta-1'
const OUTRA = 'conta-2'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const ETAPA_PROPOSTA = uuid(1)
const ETAPA_GANHO = uuid(2)
const ETAPA_DE_OUTRA = uuid(3)
const TAG_VIP = uuid(10)
const TAG_DE_OUTRA = uuid(11)
const CAMPO_TEXTO = uuid(20)
const CAMPO_DATA = uuid(21)
const CAMPO_DATA_VIGIADO = uuid(22)
const MEMBRO = uuid(30)
const AUTO_LIMPA = uuid(40)
const AUTO_COM_WEBHOOK_NA_FILHA = uuid(41)
const AUTO_FILHA = uuid(42)
const AUTO_DE_OUTRA = uuid(43)
const AUTO_DESLIGADA = uuid(44)
const AUTO_REGUA = uuid(45)
const LEMBRETE = uuid(46)

function tabelas(): Record<string, Linha[]> {
  const funil = { account_id: CONTA, name: 'Bancário' }
  return {
    pipeline_stages: [
      { id: ETAPA_PROPOSTA, name: 'Proposta', position: 2, resultado: null, pipelines: funil },
      { id: ETAPA_GANHO, name: 'Contrato Fechado', position: 5, resultado: 'ganho', pipelines: funil },
      { id: ETAPA_DE_OUTRA, name: 'Lead', position: 0, resultado: null, pipelines: { account_id: OUTRA, name: 'X' } },
    ],
    tags: [
      { id: TAG_VIP, name: 'VIP', account_id: CONTA },
      { id: TAG_DE_OUTRA, name: 'Outra', account_id: OUTRA },
    ],
    custom_fields: [
      { id: CAMPO_TEXTO, field_name: 'Tamanho da dívida', field_type: 'text', account_id: CONTA },
      { id: CAMPO_DATA, field_name: 'Data livre', field_type: 'datetime', account_id: CONTA },
      { id: CAMPO_DATA_VIGIADO, field_name: 'Data da reunião', field_type: 'datetime', account_id: CONTA },
    ],
    profiles: [{ user_id: MEMBRO, full_name: 'Ana', email: 'ana@x', account_id: CONTA }],
    automations: [
      { id: AUTO_LIMPA, name: 'Boas-vindas', account_id: CONTA, is_active: true, trigger_type: 'tag_added', trigger_config: {} },
      { id: AUTO_COM_WEBHOOK_NA_FILHA, name: 'Aciona filha', account_id: CONTA, is_active: true, trigger_type: 'tag_added', trigger_config: {} },
      { id: AUTO_FILHA, name: 'Filha', account_id: CONTA, is_active: true, trigger_type: 'tag_added', trigger_config: {} },
      { id: AUTO_DE_OUTRA, name: 'De outra', account_id: OUTRA, is_active: true, trigger_type: 'tag_added', trigger_config: {} },
      { id: AUTO_DESLIGADA, name: 'Desligada', account_id: CONTA, is_active: false, trigger_type: 'tag_added', trigger_config: {} },
      { id: AUTO_REGUA, name: 'Régua 5 dias', account_id: CONTA, is_active: true, trigger_type: 'asaas_cobranca_vencida', trigger_config: {} },
      {
        id: LEMBRETE,
        name: 'Lembrete',
        account_id: CONTA,
        is_active: true,
        trigger_type: 'date_field_offset',
        trigger_config: { custom_field_id: CAMPO_DATA_VIGIADO },
      },
    ],
    automation_steps: [
      { id: 's1', automation_id: AUTO_LIMPA, step_type: 'send_message', step_config: {}, automations: { account_id: CONTA } },
      {
        id: 's2',
        automation_id: AUTO_COM_WEBHOOK_NA_FILHA,
        step_type: 'run_automation',
        step_config: { automation_id: AUTO_FILHA },
        automations: { account_id: CONTA },
      },
      // A filha aciona a mãe de volta (ciclo) e tem o webhook.
      {
        id: 's3',
        automation_id: AUTO_FILHA,
        step_type: 'run_automation',
        step_config: { automation_id: AUTO_COM_WEBHOOK_NA_FILHA },
        automations: { account_id: CONTA },
      },
      { id: 's4', automation_id: AUTO_FILHA, step_type: 'send_webhook', step_config: {}, automations: { account_id: CONTA } },
      { id: 's5', automation_id: AUTO_DE_OUTRA, step_type: 'send_to_number', step_config: {}, automations: { account_id: OUTRA } },
    ],
  }
}

let banco: Banco
let db: SupabaseClient

beforeEach(() => {
  ;({ banco, db } = criarBanco(tabelas()))
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('conferirFerramentas — ao salvar', () => {
  it('tudo da conta e dentro da D5: ok', async () => {
    const r = await conferirFerramentas(db, CONTA, {
      mover_etapa: { etapas: [ETAPA_PROPOSTA] },
      etiquetar: { etiquetas: [TAG_VIP] },
      preencher_campo: { campos: [CAMPO_TEXTO, CAMPO_DATA] },
      criar_tarefa: { membros: [MEMBRO] },
      executar_automacao: { automacoes: [AUTO_LIMPA] },
    })
    expect(r).toEqual({ ok: true })
  })

  it('nada ligado: ok, sem ler nada', async () => {
    expect(await conferirFerramentas(db, CONTA, {})).toEqual({ ok: true })
    expect(banco.consultas).toEqual([])
  })

  it('item de OUTRA conta (etapa pelo funil, etiqueta, automação): recusado com os ids', async () => {
    const r = await conferirFerramentas(db, CONTA, {
      mover_etapa: { etapas: [ETAPA_PROPOSTA, ETAPA_DE_OUTRA] },
      tirar_etiqueta: { etiquetas: [TAG_DE_OUTRA] },
      executar_automacao: { automacoes: [AUTO_DE_OUTRA] },
    })
    expect(r).toEqual({ ok: false, codigo: 'item_de_outra_conta', itens: [ETAPA_DE_OUTRA, TAG_DE_OUTRA, AUTO_DE_OUTRA] })
  })

  it('etapa de ganho/perdido (D5): etapa_de_resultado', async () => {
    const r = await conferirFerramentas(db, CONTA, { mover_etapa: { etapas: [ETAPA_PROPOSTA, ETAPA_GANHO] } })
    expect(r).toEqual({ ok: false, codigo: 'etapa_de_resultado', itens: [ETAPA_GANHO] })
  })

  it('campo de DATA vigiado por lembrete LIGADO: campo_vigiado', async () => {
    const r = await conferirFerramentas(db, CONTA, { preencher_campo: { campos: [CAMPO_DATA, CAMPO_DATA_VIGIADO] } })
    expect(r).toEqual({ ok: false, codigo: 'campo_vigiado', itens: [CAMPO_DATA_VIGIADO] })
  })

  it('o lembrete DESLIGADO não vigia', async () => {
    banco.tabelas.automations.find((a) => a.id === LEMBRETE)!.is_active = false
    expect(await conferirFerramentas(db, CONTA, { preencher_campo: { campos: [CAMPO_DATA_VIGIADO] } })).toEqual({ ok: true })
  })

  it('automação que ACIONA outra com passo fora da D5 (com ciclo no meio): automacao_fora_da_d5', async () => {
    const r = await conferirFerramentas(db, CONTA, {
      executar_automacao: { automacoes: [AUTO_LIMPA, AUTO_COM_WEBHOOK_NA_FILHA] },
    })
    expect(r).toEqual({ ok: false, codigo: 'automacao_fora_da_d5', itens: [AUTO_COM_WEBHOOK_NA_FILHA] })
  })

  it('erro de leitura LANÇA (nunca "está tudo certo")', async () => {
    banco.falhas.add('tags')
    await expect(conferirFerramentas(db, CONTA, { etiquetar: { etiquetas: [TAG_VIP] } })).rejects.toThrow(/fora do ar/)
  })
})

describe('motivosForaDaD5', () => {
  it('lê só passos de automação DESTA conta, e responde por automação', async () => {
    const m = await motivosForaDaD5(db, CONTA, [AUTO_LIMPA, AUTO_COM_WEBHOOK_NA_FILHA, AUTO_DE_OUTRA])
    expect(m.get(AUTO_LIMPA)).toBeNull()
    expect(m.get(AUTO_COM_WEBHOOK_NA_FILHA)).toBe('send_webhook')
    // A de outra conta não é lida (o passo `send_to_number` dela não aparece).
    expect(m.get(AUTO_DE_OUTRA)).toBeNull()
    for (const c of banco.consultas.filter((c) => c.tabela === 'automation_steps')) {
      expect(c.filtros).toContainEqual(['eq', 'automations.account_id', CONTA])
    }
  })

  it('passo que move para etapa de ganho, ou preenche campo vigiado', async () => {
    banco.tabelas.automation_steps.push(
      { id: 's9', automation_id: AUTO_LIMPA, step_type: 'move_deal_stage', step_config: { stage_id: ETAPA_GANHO }, automations: { account_id: CONTA } },
    )
    expect((await motivosForaDaD5(db, CONTA, [AUTO_LIMPA])).get(AUTO_LIMPA)).toBe('etapa_de_resultado')
    banco.tabelas.automation_steps.pop()
    banco.tabelas.automation_steps.push({
      id: 's10',
      automation_id: AUTO_LIMPA,
      step_type: 'update_contact_field',
      step_config: { field: `custom:${CAMPO_DATA_VIGIADO}` },
      automations: { account_id: CONTA },
    })
    expect((await motivosForaDaD5(db, CONTA, [AUTO_LIMPA])).get(AUTO_LIMPA)).toBe('campo_vigiado')
  })

  it('erro de leitura lança (a ação recusa: na dúvida, a IA não dispara)', async () => {
    banco.falhas.add('automation_steps')
    await expect(motivosForaDaD5(db, CONTA, [AUTO_LIMPA])).rejects.toThrow()
  })
})

describe('opcoesDoAgente — o que o pedido lista', () => {
  it('só os itens LIGADOS, da conta e possíveis agora, com os nomes', async () => {
    const o = await opcoesDoAgente(db, CONTA, {
      mover_etapa: { etapas: [ETAPA_PROPOSTA, ETAPA_GANHO, ETAPA_DE_OUTRA] },
      etiquetar: { etiquetas: [TAG_VIP, TAG_DE_OUTRA] },
      tirar_etiqueta: { etiquetas: [TAG_VIP] },
      preencher_campo: { campos: [CAMPO_TEXTO, CAMPO_DATA_VIGIADO] },
      criar_tarefa: { membros: [MEMBRO] },
      executar_automacao: { automacoes: [AUTO_LIMPA, AUTO_DESLIGADA, AUTO_REGUA, AUTO_DE_OUTRA] },
    })
    expect(o).toEqual({
      mover_etapa: [{ id: ETAPA_PROPOSTA, nome: 'Bancário · Proposta' }],
      etiquetar: [{ id: TAG_VIP, nome: 'VIP' }],
      tirar_etiqueta: [{ id: TAG_VIP, nome: 'VIP' }],
      preencher_campo: [{ id: CAMPO_TEXTO, nome: 'Tamanho da dívida' }],
      criar_tarefa: [{ id: MEMBRO, nome: 'Ana' }],
      executar_automacao: [{ id: AUTO_LIMPA, nome: 'Boas-vindas' }],
    })
  })

  it('agente sem ferramenta não lê nada', async () => {
    expect(await opcoesDoAgente(db, CONTA, {})).toEqual({})
    expect(banco.consultas).toEqual([])
  })

  it('leitura que falha tira SÓ aquele tipo, e nunca lança', async () => {
    banco.falhas.add('tags')
    const o = await opcoesDoAgente(db, CONTA, {
      etiquetar: { etiquetas: [TAG_VIP] },
      criar_tarefa: { membros: [MEMBRO] },
    })
    expect(o).toEqual({ criar_tarefa: [{ id: MEMBRO, nome: 'Ana' }] })
  })
})

describe('lerCatalogoDeFerramentas — a tela só mostra', () => {
  it('tudo da conta, com resultado, vigiado e o motivo da D5; sem a régua do Asaas', async () => {
    const c = await lerCatalogoDeFerramentas(db, CONTA)
    expect(c.etapas).toEqual([
      { id: ETAPA_PROPOSTA, nome: 'Proposta', funil: 'Bancário', resultado: null },
      { id: ETAPA_GANHO, nome: 'Contrato Fechado', funil: 'Bancário', resultado: 'ganho' },
    ])
    expect(c.etiquetas).toEqual([{ id: TAG_VIP, nome: 'VIP' }])
    expect(c.campos).toEqual([
      { id: CAMPO_DATA_VIGIADO, nome: 'Data da reunião', vigiado: true },
      { id: CAMPO_DATA, nome: 'Data livre', vigiado: false },
      { id: CAMPO_TEXTO, nome: 'Tamanho da dívida', vigiado: false },
    ])
    expect(c.membros).toEqual([{ userId: MEMBRO, nome: 'Ana' }])
    expect(c.automacoes.map((a) => [a.nome, a.foraDaD5])).toEqual([
      ['Aciona filha', 'send_webhook'],
      ['Boas-vindas', null],
      ['Desligada', null],
      ['Filha', 'send_webhook'],
      ['Lembrete', null],
    ])
  })

  it('leitura que falha LANÇA (um catálogo pela metade diria "a conta não tem etiquetas")', async () => {
    banco.falhas.add('tags')
    await expect(lerCatalogoDeFerramentas(db, CONTA)).rejects.toThrow()
  })
})
