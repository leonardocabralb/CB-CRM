import { describe, expect, it } from 'vitest'

import { agruparItens, itensDoTipo, lerAcoesDoTurno, lerAcoesSimuladas, lerOpcoes } from './ferramentas'
import type { OpcoesDasFerramentas } from './tipos'

const OPCOES: OpcoesDasFerramentas = {
  etapas: [
    { id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null },
    { id: 'e2', nome: 'Contrato Fechado', funil: 'Comercial', resultado: 'ganho' },
    { id: 'e3', nome: 'Triagem', funil: 'Jurídico', resultado: null },
    { id: 'e4', nome: 'Perdido', funil: 'Comercial', resultado: 'perdido' },
  ],
  etiquetas: [{ id: 't1', nome: 'VIP' }],
  campos: [
    { id: 'c1', nome: 'Tamanho da dívida', vigiado: false },
    { id: 'c2', nome: 'Data e Hora Reunião', vigiado: true },
  ],
  membros: [{ userId: 'u1', nome: 'Ana' }],
  automacoes: [
    { id: 'a1', nome: 'Boas-vindas', foraDaD5: null },
    { id: 'a2', nome: 'Aviso ao advogado', foraDaD5: 'send_to_number' },
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
      etapas: [{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: 'ganhou' }, { id: 7 }],
      campos: [{ id: 'c1', nome: 'X', vigiado: 'true' }],
      automacoes: [{ id: 'a1', nome: 'A', foraDaD5: '' }],
    })
    expect(lida?.etapas).toEqual([{ id: 'e1', nome: 'Lead', funil: 'Comercial', resultado: null }])
    expect(lida?.campos).toEqual([{ id: 'c1', nome: 'X', vigiado: false }])
    expect(lida?.automacoes).toEqual([{ id: 'a1', nome: 'A', foraDaD5: null }])
  })
})

describe('itensDoTipo — a lista de cada tipo de ação', () => {
  it('etapas: agrupadas pelo funil; as de ganho/perdido bloqueadas (D5)', () => {
    const itens = itensDoTipo(OPCOES, 'mover_etapa')
    expect(itens.map((i) => [i.id, i.grupo, i.bloqueio?.tipo ?? null])).toEqual([
      ['e1', 'Comercial', null],
      ['e2', 'Comercial', 'etapa_de_resultado'],
      ['e3', 'Jurídico', null],
      ['e4', 'Comercial', 'etapa_de_resultado'],
    ])
  })

  it('agruparItens junta pelo PRIMEIRO aparecimento do funil, sem repetir o grupo', () => {
    const grupos = agruparItens(itensDoTipo(OPCOES, 'mover_etapa'))
    expect(grupos.map((g) => [g.grupo, g.itens.map((i) => i.id)])).toEqual([
      ['Comercial', ['e1', 'e2', 'e4']],
      ['Jurídico', ['e3']],
    ])
  })

  it('etiquetar e tirar etiqueta usam o mesmo catálogo', () => {
    expect(itensDoTipo(OPCOES, 'etiquetar')).toEqual(itensDoTipo(OPCOES, 'tirar_etiqueta'))
  })

  it('campo vigiado e automação fora da D5 vêm bloqueados, com o código do passo', () => {
    expect(itensDoTipo(OPCOES, 'preencher_campo').map((i) => i.bloqueio)).toEqual([null, { tipo: 'campo_vigiado' }])
    expect(itensDoTipo(OPCOES, 'executar_automacao').map((i) => i.bloqueio)).toEqual([
      null,
      { tipo: 'fora_da_d5', codigo: 'send_to_number' },
    ])
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

  it('forma estranha ou ausente = undefined (nada é mostrado)', () => {
    expect(lerAcoesSimuladas(undefined)).toBeUndefined()
    expect(lerAcoesSimuladas({ aceitas: [] })).toBeUndefined()
    expect(lerAcoesSimuladas('x')).toBeUndefined()
  })
})

describe('lerAcoesDoTurno — cb_ia_turnos.acoes', () => {
  it('lê ok e falha, com o erro só quando há texto', () => {
    expect(
      lerAcoesDoTurno([
        { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true },
        { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
        { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true, erro: '  ' },
      ]),
    ).toEqual([
      { tipo: 'mover_etapa', alvo: { id: 'e1', nome: 'Proposta' }, ok: true },
      { tipo: 'etiquetar', alvo: { id: null, nome: 'VIP' }, ok: false, erro: 'banco' },
      { tipo: 'criar_tarefa', alvo: { id: 'u1', nome: 'Ana' }, ok: true },
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
