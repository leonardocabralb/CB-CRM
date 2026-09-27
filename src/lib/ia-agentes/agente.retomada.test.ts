import { describe, expect, it } from 'vitest'

import { colunasDaAlteracao, COLUNAS_DO_AGENTE, lerAlteracao, lerLinhaDoAgente } from './agente'

// ============================================================
// A retomada no agente (1056): a coluna lida, o PATCH estrito e a coluna
// gravada.
// ============================================================

const ID = '11111111-1111-4111-8111-111111111111'
const BOA = { ativa: true, cadencia: [15, 60, 180], janela: { inicio: '08:00', fim: '21:00' } }

describe('o agente lê a retomada', () => {
  it('a coluna está na leitura (nomeada — sem ela, a retomada do agente nunca chegaria ao turno)', () => {
    expect(COLUNAS_DO_AGENTE.split(',').map((c) => c.trim())).toContain('retomada')
  })

  it('nula (agente de antes da 1056): desligada, com o padrão', () => {
    const a = lerLinhaDoAgente({ id: ID, account_id: ID, provedor: 'gemini', retomada: null })
    expect(a?.retomada).toEqual({ ativa: false, cadencia: [15, 60, 180, 360, 720, 2880], janela: { inicio: '08:00', fim: '21:00' } })
  })

  it('gravada: como está', () => {
    expect(lerLinhaDoAgente({ id: ID, account_id: ID, provedor: 'gemini', retomada: BOA })?.retomada).toEqual(BOA)
  })
})

describe('lerAlteracao — retomada (PATCH)', () => {
  it('o objeto inteiro, na forma: passa', () => {
    const r = lerAlteracao({ retomada: BOA }, false)
    expect(r).toEqual({ ok: true, valor: { retomada: BOA } })
  })

  it.each<[string, unknown]>([
    ['nula', null],
    ['sem a chave ativa', { cadencia: [15], janela: BOA.janela }],
    ['cadência fora de ordem', { ...BOA, cadencia: [60, 15] }],
    ['janela invertida', { ...BOA, janela: { inicio: '21:00', fim: '08:00' } }],
  ])('%s: recusa com retomada_invalida (nunca descarta em silêncio)', (_rotulo, retomada) => {
    expect(lerAlteracao({ retomada }, false)).toEqual({ ok: false, codigo: 'retomada_invalida' })
  })

  it('ausente: não mexe', () => {
    const r = lerAlteracao({ nome: 'X' }, false)
    expect(r.ok && 'retomada' in r.valor).toBe(false)
  })
})

describe('colunasDaAlteracao — retomada', () => {
  it('vira a coluna `retomada`', () => {
    expect(colunasDaAlteracao({ retomada: BOA })).toEqual({ retomada: BOA })
  })
})
