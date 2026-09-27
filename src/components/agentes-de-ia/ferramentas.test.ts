import { describe, expect, it } from 'vitest'

import { agruparItens, itensDoTipo, lerAcoesDoTurno, lerAcoesSimuladas, lerOpcoes } from './ferramentas'
import type { OpcoesDasFerramentas } from './tipos'

const OPCOES: OpcoesDasFerramentas = {
  etapas: [
    { id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null, foraDaD5: null },
    // Ganho E cascata: o motivo mostrado é o do ganho.
    { id: 'e2', nome: 'Contrato Fechado', funil: 'Comercial', resultado: 'ganho', foraDaD5: 'send_webhook' },
    { id: 'e3', nome: 'Triagem', funil: 'Jurídico', resultado: null, foraDaD5: null },
    { id: 'e4', nome: 'Perdido', funil: 'Comercial', resultado: 'perdido', foraDaD5: null },
    // A cascata: uma automação que dispara ao entrar na etapa manda para outro número.
    { id: 'e5', nome: 'Reunião Agendada', funil: 'Comercial', resultado: null, foraDaD5: 'send_to_number' },
  ],
  etiquetas: [
    { id: 't1', nome: 'VIP', foraDaD5: { etiquetar: null, tirar: null } },
    { id: 't2', nome: 'Contrato', foraDaD5: { etiquetar: 'send_webhook', tirar: null } },
    { id: 't3', nome: '-150k', foraDaD5: { etiquetar: null, tirar: 'status_de_resultado' } },
  ],
  campos: [
    { id: 'c1', nome: 'Tamanho da dívida', vigiado: false, tipo: 'number', opcoes: [] },
    { id: 'c2', nome: 'Data e Hora Reunião', vigiado: true, tipo: 'datetime', opcoes: [] },
    { id: 'c3', nome: 'Área', vigiado: false, tipo: 'select', opcoes: ['Bancário', 'Trabalhista'] },
  ],
  membros: [{ userId: 'u1', nome: 'Ana' }],
  automacoes: [
    { id: 'a1', nome: 'Boas-vindas', foraDaD5: null },
    { id: 'a2', nome: 'Aviso ao advogado', foraDaD5: 'send_to_number' },
    { id: 'a3', nome: 'Recuperação de No Show', foraDaD5: 'aguardar' },
  ],
}

describe('lerOpcoes — a resposta de …/ferramentas/opcoes', () => {
  it('a forma do contrato passa inteira', () => {
    expect(lerOpcoes(JSON.parse(JSON.stringify(OPCOES)))).toEqual(OPCOES)
  })

  it('lista ausente = a carga falhou (null), nunca "a conta não tem"', () => {
    expect(lerOpcoes({ ...OPCOES, automacoes: undefined })).toBeNull()
    expect(lerOpcoes(null)).toBeNull()
    expect(lerOpcoes([])).toBeNull()
  })

  it('item com forma estranha sai; o bloqueio só existe com o valor exato', () => {
    const lida = lerOpcoes({
      ...OPCOES,
      etapas: [{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: 'ganhou', foraDaD5: '  ' }, { id: 7 }],
      etiquetas: [
        { id: 't1', nome: 'VIP' },
        { id: 't2', nome: 'Y', foraDaD5: { etiquetar: 5, tirar: 'run_flow' } },
      ],
      campos: [{ id: 'c1', nome: 'X', vigiado: 'true', opcoes: ['a', 3] }],
      automacoes: [{ id: 'a1', nome: 'A', foraDaD5: '' }],
    })
    expect(lida?.etapas).toEqual([{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null, foraDaD5: null }])
    // Cascata ausente ou com forma estranha não inventa bloqueio.
    expect(lida?.etiquetas).toEqual([
      { id: 't1', nome: 'VIP', foraDaD5: { etiquetar: null, tirar: null } },
      { id: 't2', nome: 'Y', foraDaD5: { etiquetar: null, tirar: 'run_flow' } },
    ])
    // Tipo ausente = nulo (a tela não mostra rótulo); opção que não é texto sai.
    expect(lida?.campos).toEqual([{ id: 'c1', nome: 'X', vigiado: false, tipo: null, opcoes: ['a'] }])
    expect(lida?.automacoes).toEqual([{ id: 'a1', nome: 'A', foraDaD5: null }])
  })
})

describe('itensDoTipo — a lista de cada tipo de ação', () => {
  it('etapas: agrupadas pelo funil; as de ganho/perdido e as de cascata fora da D5 bloqueadas', () => {
    const itens = itensDoTipo(OPCOES, 'mover_etapa')
    expect(itens.map((i) => [i.id, i.grupo, i.bloqueio])).toEqual([
      ['e1', 'Comercial', null],
      // Ganho vence a cascata.
      ['e2', 'Comercial', { tipo: 'etapa_de_resultado' }],
      ['e3', 'Jurídico', null],
      ['e4', 'Comercial', { tipo: 'etapa_de_resultado' }],
      ['e5', 'Comercial', { tipo: 'cascata', gatilho: 'etapa', codigo: 'send_to_number' }],
    ])
  })

  it('agruparItens junta pelo PRIMEIRO aparecimento do funil, sem repetir o grupo', () => {
    const grupos = agruparItens(itensDoTipo(OPCOES, 'mover_etapa'))
    expect(grupos.map((g) => [g.grupo, g.itens.map((i) => i.id)])).toEqual([
      ['Comercial', ['e1', 'e2', 'e4', 'e5']],
      ['Jurídico', ['e3']],
    ])
  })

  it('etiquetar e tirar etiqueta: o mesmo catálogo, cada lista com a SUA cascata', () => {
    const aplicar = itensDoTipo(OPCOES, 'etiquetar')
    const tirar = itensDoTipo(OPCOES, 'tirar_etiqueta')
    expect(aplicar.map((i) => i.id)).toEqual(tirar.map((i) => i.id))
    expect(aplicar.map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'cascata', gatilho: 'etiquetar', codigo: 'send_webhook' },
      null,
    ])
    expect(tirar.map((i) => i.bloqueio)).toEqual([
      null,
      null,
      { tipo: 'cascata', gatilho: 'tirar', codigo: 'status_de_resultado' },
    ])
  })

  it('campo vigiado e automação fora da D5 (ou com "Aguardar") vêm bloqueados, com o código do passo', () => {
    expect(itensDoTipo(OPCOES, 'preencher_campo').map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'campo_vigiado' },
      null,
    ])
    expect(itensDoTipo(OPCOES, 'executar_automacao').map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'fora_da_d5', codigo: 'send_to_number' },
      { tipo: 'fora_da_d5', codigo: 'aguardar' },
    ])
  })

  it('campos levam o tipo e as opções (a tela mostra ao lado do nome); as outras listas, não', () => {
    expect(itensDoTipo(OPCOES, 'preencher_campo').map((i) => i.campo)).toEqual([
      { tipo: 'number', opcoes: [] },
      { tipo: 'datetime', opcoes: [] },
      { tipo: 'select', opcoes: ['Bancário', 'Trabalhista'] },
    ])
    expect(itensDoTipo(OPCOES, 'etiquetar').every((i) => i.campo === undefined)).toBe(true)
  })

  it('membros: o id é o userId (quem recebe a tarefa)', () => {
    expect(itensDoTipo(OPCOES, 'criar_tarefa')).toEqual([{ id: 'u1', nome: 'Ana', grupo: null, bloqueio: null }])
  })
})

describe('lerAcoesSimuladas — as ações do Playground', () => {
  it('lê aceitas e recusadas', () => {
    const v = {
      aceitas: [{ tipo: 'mover_etapa', nome: 'Proposta' }],
      recusadas: [{ tipo: 'etiquetar', motivo: 'fora_da_lista' }],
    }
    expect(lerAcoesSimuladas(v)).toEqual(v)
  })

  it('o valor (campo, tarefa) vem junto; vazio ou não-texto = sem valor', () => {
    expect(
      lerAcoesSimuladas({
        aceitas: [
          { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
          { tipo: 'preencher_campo', nome: 'Tamanho da dívida', valor: '  ' },
          { tipo: 'preencher_campo', nome: 'X', valor: 200 },
        ],
        recusadas: [],
      })?.aceitas,
    ).toEqual([
      { tipo: 'criar_tarefa', nome: 'Ana', valor: 'Ligar amanhã' },
      { tipo: 'preencher_campo', nome: 'Tamanho da dívida' },
      { tipo: 'preencher_campo', nome: 'X' },
    ])
  })

  it('forma estranha ou ausente = undefined (nada é mostrado)', () => {
    expect(lerAcoesSimuladas(undefined)).toBeUndefined()
    expect(lerAcoesSimuladas({ aceitas: [] })).toBeUndefined()
    expect(lerAcoesSimuladas('x')).toBeUndefined()
  })
})

describe('lerAcoesDoTurno — cb_ia_turnos.acoes', () => {
  it('lê ok e falha, com o erro e o detalhe só quando há texto', () => {
    expect(
      lerAcoesDoTurno([
        { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
        { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
        { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true, erro: '  ', detalhe: '' },
        {
          tipo: 'executar_automacao',
          alvo: { id: 'a1', nome: 'Aviso' },
          ok: false,
          erro: 'automacao_fora_da_d5',
          detalhe: 'send_webhook',
        },
      ]),
    ).toEqual([
      { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true, detalhe: 'ja_estava' },
      { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
      { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true },
      {
        tipo: 'executar_automacao',
        alvo: { id: 'a1', nome: 'Aviso' },
        ok: false,
        erro: 'automacao_fora_da_d5',
        detalhe: 'send_webhook',
      },
    ])
  })

  it('turno antigo (null) ou forma estranha = null; item estranho sai sem quebrar a lista', () => {
    expect(lerAcoesDoTurno(null)).toBeNull()
    expect(lerAcoesDoTurno({})).toBeNull()
    expect(lerAcoesDoTurno([{ tipo: 'mover_etapa', ok: true }, { tipo: 'x', alvo: { nome: 'y' }, ok: true }])).toEqual([
      { tipo: 'x', alvo: { id: null, nome: 'y' }, ok: true },
    ])
  })
})
