import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  campoAtendeACondicao,
  camposDasCondicoes,
  carregarCamposParaCondicoes,
  operadorDaCondicao,
  operadoresDoTipo,
  problemaDaCondicaoPorCampo,
  problemaDaFormaDaCondicao,
} from './condicao-por-campo'

// ============================================================
// Condição por CAMPO PERSONALIZADO (Fase 2.10 do plano do previdenciário):
// é o que faz voltar ao robô SÓ o "Desqualificado" por "Não respondeu".
// ============================================================

const CAMPO = '11111111-1111-4111-8111-111111111111'
const MOTIVO = {
  field_name: 'Motivo da desqualificação',
  field_type: 'select',
  opcoes: ['Não respondeu', 'Não reengajou', 'Já tem advogado', 'Outro'],
}

describe('operadorDaCondicao', () => {
  it('ausente = "é"; conhecido passa; qualquer outra coisa = null', () => {
    expect(operadorDaCondicao(undefined)).toBe('equals')
    expect(operadorDaCondicao('')).toBe('equals')
    expect(operadorDaCondicao('not_empty')).toBe('not_empty')
    expect(operadorDaCondicao('starts_with')).toBeNull()
    expect(operadorDaCondicao(1)).toBeNull()
  })
})

describe('operadoresDoTipo — o menor conjunto que serve', () => {
  it('texto: os quatro; lista e número: sem "contém"; data: só vazio/preenchido', () => {
    expect(operadoresDoTipo('text')).toEqual(['equals', 'contains', 'empty', 'not_empty'])
    expect(operadoresDoTipo('select')).toEqual(['equals', 'empty', 'not_empty'])
    expect(operadoresDoTipo('number')).toEqual(['equals', 'empty', 'not_empty'])
    expect(operadoresDoTipo('datetime')).toEqual(['empty', 'not_empty'])
  })
})

describe('campoAtendeACondicao', () => {
  const ver = (operador: 'equals' | 'contains' | 'empty' | 'not_empty', gravado: string | null, esperado = '', tipo = 'text') =>
    campoAtendeACondicao({ operador, tipo, gravado, esperado })

  it('"é": aparado e sem maiúsculas; acento conta', () => {
    expect(ver('equals', 'Não respondeu', 'não respondeu ')).toBe(true)
    expect(ver('equals', 'Não respondeu', 'Nao respondeu')).toBe(false)
    expect(ver('equals', 'Não reengajou', 'Não respondeu')).toBe(false)
  })

  it('"é" nunca casa com valor esperado vazio nem com campo vazio', () => {
    expect(ver('equals', '', '')).toBe(false)
    expect(ver('equals', null, 'x')).toBe(false)
    expect(ver('contains', 'algo', '  ')).toBe(false)
  })

  it('vazio/preenchido: sem linha, "" e só espaços são VAZIO', () => {
    expect(ver('empty', null)).toBe(true)
    expect(ver('empty', '   ')).toBe(true)
    expect(ver('empty', 'x')).toBe(false)
    expect(ver('not_empty', null)).toBe(false)
    expect(ver('not_empty', 'x')).toBe(true)
  })

  it('número: "é" compara o VALOR pela régua do robô ("150.000" é 150 mil)', () => {
    expect(ver('equals', '150000', '150.000', 'number')).toBe(true)
    expect(ver('equals', '2.5', '2,5', 'number')).toBe(true)
    expect(ver('equals', '150000', '150', 'number')).toBe(false)
  })
})

describe('problemaDaFormaDaCondicao (sem banco)', () => {
  it('operador desconhecido e "é"/"contém" sem valor', () => {
    expect(problemaDaFormaDaCondicao({ operator: 'starts_with' })).toMatch(/operador desconhecido/)
    expect(problemaDaFormaDaCondicao({ operator: 'equals', value: '  ' })).toMatch(/precisa do valor/)
    expect(problemaDaFormaDaCondicao({ operator: 'empty' })).toBeNull()
    expect(problemaDaFormaDaCondicao({ operator: 'contains', value: 'x' })).toBeNull()
  })
})

describe('problemaDaCondicaoPorCampo (com os campos da conta)', () => {
  it('CRÍTICO: campo que não existe nesta conta (apagado ou de outra) recusa', () => {
    expect(problemaDaCondicaoPorCampo({ operator: 'empty' }, undefined)).toMatch(/não existe nesta conta/)
  })

  it('lista: o valor tem de ser uma das opções (as opções mudaram?)', () => {
    expect(problemaDaCondicaoPorCampo({ operator: 'equals', value: 'Não respondeu' }, MOTIVO)).toBeNull()
    expect(problemaDaCondicaoPorCampo({ operator: 'equals', value: 'Sumiu' }, MOTIVO)).toMatch(/não é uma opção/)
  })

  it('operador que o tipo não aceita', () => {
    expect(problemaDaCondicaoPorCampo({ operator: 'contains', value: 'x' }, MOTIVO)).toMatch(/não aceita "contém"/)
    expect(
      problemaDaCondicaoPorCampo({ operator: 'equals', value: '30/08/2026' }, { field_name: 'Data', field_type: 'datetime', opcoes: [] }),
    ).toMatch(/é uma data/)
  })

  it('número: o valor tem de ser número', () => {
    const tamanho = { field_name: 'Tamanho da dívida', field_type: 'number', opcoes: [] }
    expect(problemaDaCondicaoPorCampo({ operator: 'equals', value: 'muito' }, tamanho)).toMatch(/precisa ser um número/)
    expect(problemaDaCondicaoPorCampo({ operator: 'equals', value: '150.000' }, tamanho)).toBeNull()
  })

  it('o que é da FORMA não sai duas vezes (fica com problemaDaFormaDaCondicao)', () => {
    expect(problemaDaCondicaoPorCampo({ operator: 'starts_with' }, MOTIVO)).toBeNull()
    expect(problemaDaCondicaoPorCampo({ operator: 'equals', value: '' }, MOTIVO)).toBeNull()
  })
})

describe('camposDasCondicoes / carregarCamposParaCondicoes', () => {
  const cond = (operand: string) => ({ step_type: 'condition', step_config: { subject: 'custom_field', operand } })
  const passos = [
    { step_type: 'send_message', step_config: { text: 'oi' } },
    {
      ...cond(CAMPO),
      branches: {
        yes: [cond('22222222-2222-4222-8222-222222222222')],
        no: [{ step_type: 'condition', step_config: { subject: 'deal_stage', operand: CAMPO } }, cond('lixo')],
      },
    },
  ]

  it('colhe o operando das condições por campo, inclusive nos ramos (e só com forma de id)', () => {
    expect(camposDasCondicoes(passos)).toEqual([CAMPO, '22222222-2222-4222-8222-222222222222'])
  })

  it('lê os campos pela CONTA; sem condição, nem consulta; leitura que falha = null', async () => {
    const pedidos: Array<Array<[string, unknown]>> = []
    const banco = (resp: { data: unknown; error: unknown }) =>
      ({
        from: () => {
          const filtros: Array<[string, unknown]> = []
          pedidos.push(filtros)
          const b = {
            select: () => b,
            eq: (c: string, v: unknown) => (filtros.push([c, v]), b),
            in: (c: string, v: unknown) => (filtros.push([c, v]), Promise.resolve(resp)),
          }
          return b
        },
      }) as unknown as SupabaseClient

    const r = await carregarCamposParaCondicoes(
      banco({ data: [{ id: CAMPO, field_name: 'Motivo', field_type: 'select', field_options: { opcoes: ['A'] } }], error: null }),
      'acc',
      passos,
    )
    expect(r?.get(CAMPO)).toEqual({ field_name: 'Motivo', field_type: 'select', opcoes: ['A'] })
    expect(pedidos[0]).toContainEqual(['account_id', 'acc'])

    pedidos.length = 0
    expect(await carregarCamposParaCondicoes(banco({ data: [], error: null }), 'acc', [passos[0]])).toEqual(new Map())
    expect(pedidos).toHaveLength(0)

    expect(await carregarCamposParaCondicoes(banco({ data: null, error: { message: 'x' } }), 'acc', passos)).toBeNull()
  })
})
