import { describe, expect, it } from 'vitest'

import { colunasDaAlteracao, lerAlteracao, lerHorario, lerLinhaDoAgente } from './agente'

const ID = '11111111-1111-4111-8111-111111111111'

describe('lerAlteracao', () => {
  it('na edição, trocar o provedor exige o modelo junto (Codex, #295)', () => {
    expect(lerAlteracao({ provedor: 'openai' }, false)).toEqual({ ok: false, codigo: 'modelo_vazio' })
    expect(lerAlteracao({ provedor: 'openai', modelo: 'gpt-x' }, false)).toEqual({
      ok: true,
      valor: { provedor: 'openai', modelo: 'gpt-x' },
    })
    expect(lerAlteracao({ modelo: 'gpt-y' }, false)).toEqual({ ok: true, valor: { modelo: 'gpt-y' } })
  })

  it('criação exige nome, provedor e modelo', () => {
    expect(lerAlteracao({ provedor: 'gemini', modelo: 'm' }, true)).toEqual({ ok: false, codigo: 'nome_vazio' })
    expect(lerAlteracao({ nome: 'Triagem', modelo: 'm' }, true)).toEqual({ ok: false, codigo: 'provedor_invalido' })
    expect(lerAlteracao({ nome: 'Triagem', provedor: 'gemini' }, true)).toEqual({ ok: false, codigo: 'modelo_vazio' })
    const r = lerAlteracao({ nome: ' Triagem ', provedor: 'gemini', modelo: ' gemini-3.7-flash ' }, true)
    expect(r).toEqual({ ok: true, valor: { nome: 'Triagem', provedor: 'gemini', modelo: 'gemini-3.7-flash' } })
  })

  it('edição: campo AUSENTE não mexe', () => {
    expect(lerAlteracao({ ativo: true }, false)).toEqual({ ok: true, valor: { ativo: true } })
  })

  it('regras chegam aparadas, sem linha vazia (D23)', () => {
    const r = lerAlteracao({ regras: ['  Nunca prometa resultado. ', '', '   ', 'Não fale de valores.'] }, false)
    expect(r).toEqual({ ok: true, valor: { regras: ['Nunca prometa resultado.', 'Não fale de valores.'] } })
  })

  it('regras demais ou longas demais são recusadas', () => {
    expect(lerAlteracao({ regras: Array.from({ length: 31 }, (_, i) => `r${i}`) }, false)).toEqual({
      ok: false,
      codigo: 'regras_demais',
    })
    expect(lerAlteracao({ regras: ['x'.repeat(501)] }, false)).toEqual({ ok: false, codigo: 'regra_longa' })
  })

  it('só o booleano true liga', () => {
    expect(lerAlteracao({ ativo: 'true' }, false)).toEqual({ ok: true, valor: { ativo: false } })
  })

  it('listas de ids recusam o que não é uuid', () => {
    expect(lerAlteracao({ conexoes: ['x'] }, false)).toEqual({ ok: false, codigo: 'lista_invalida' })
    expect(lerAlteracao({ conexoes: [ID, ID] }, false)).toEqual({ ok: true, valor: { conexoes: [ID] } })
    expect(lerAlteracao({ conexoes: [] }, false)).toEqual({ ok: true, valor: { conexoes: [] } })
  })

  it('teto e horário validados', () => {
    expect(lerAlteracao({ teto_respostas: 0 }, false)).toEqual({ ok: false, codigo: 'teto_invalido' })
    expect(lerAlteracao({ teto_respostas: 2.5 }, false)).toEqual({ ok: false, codigo: 'teto_invalido' })
    expect(lerAlteracao({ horario: { dias: [1], inicio: '18:00', fim: '08:00' } }, false)).toEqual({
      ok: false,
      codigo: 'horario_invalido',
    })
    expect(lerAlteracao({ horario: null }, false)).toEqual({ ok: true, valor: { horario: null } })
  })

  it('transferir_para vazio = fila', () => {
    expect(lerAlteracao({ transferir_para: '' }, false)).toEqual({ ok: true, valor: { transferirPara: null } })
  })
})

describe('lerHorario', () => {
  it('dias ordenados, únicos e dentro de 0–6', () => {
    expect(lerHorario({ dias: [5, 1, 1, 9, 3], inicio: '08:00', fim: '18:00' })).toEqual({
      dias: [1, 3, 5],
      inicio: '08:00',
      fim: '18:00',
    })
  })
  it('forma estranha = nulo (sempre), nunca exceção', () => {
    expect(lerHorario({ dias: [], inicio: '08:00', fim: '18:00' })).toBeNull()
    expect(lerHorario({ dias: [1], inicio: '8h', fim: '18:00' })).toBeNull()
    expect(lerHorario('x')).toBeNull()
  })
})

describe('lerLinhaDoAgente', () => {
  it('provedor desconhecido descarta a linha', () => {
    expect(lerLinhaDoAgente({ id: ID, account_id: ID, provedor: 'x' })).toBeNull()
  })
  it('lê listas e booleanos só pela forma certa', () => {
    const a = lerLinhaDoAgente({
      id: ID,
      account_id: ID,
      provedor: 'gemini',
      ativo: 'true',
      regras: ['a', 1, 'b'],
      conexoes: null,
    })
    expect(a?.ativo).toBe(false)
    expect(a?.regras).toEqual(['a', 'b'])
    expect(a?.conexoes).toEqual([])
  })
})

describe('colunasDaAlteracao', () => {
  it('só as colunas presentes, com o nome do banco', () => {
    expect(colunasDaAlteracao({ tetoRespostas: 5, podePassarPara: [ID] })).toEqual({
      teto_respostas: 5,
      pode_passar_para: [ID],
    })
  })
})
