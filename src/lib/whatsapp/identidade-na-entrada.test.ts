import { describe, expect, it } from 'vitest'

import { contatoDaMensagem, identidadeNaEntrada } from './identidade-na-entrada'

// Ids e números fictícios, nas duas formas de payload da doc de BSUID da Meta.
const BSUID = 'BR.13491208655302741918'
const PAI = 'BR.ENT.11815799212886844830'

describe('identidadeNaEntrada', () => {
  it('payload antigo, só com telefone: o mesmo de sempre', () => {
    expect(
      identidadeNaEntrada({ from: '5583900000001' }, { wa_id: '5583900000001', profile: { name: 'Ana' } }),
    ).toEqual({
      telefone: '5583900000001',
      waUserId: null,
      waParentUserId: null,
      waUsername: null,
      nome: 'Ana',
    })
  })

  it('só-BSUID: telefone NULO, nunca a string vazia (P4)', () => {
    const id = identidadeNaEntrada(
      { from_user_id: BSUID, from_parent_user_id: PAI },
      { user_id: BSUID, parent_user_id: PAI, profile: { name: 'Bia', username: 'bia.silva' } },
    )
    expect(id.telefone).toBeNull()
    expect(id).toEqual({
      telefone: null,
      waUserId: BSUID,
      waParentUserId: PAI,
      waUsername: 'bia.silva',
      nome: 'Bia',
    })
  })

  it('sem nome no perfil o nome é NULO — nunca o @ nem o BSUID', () => {
    // O gatilho do título (1007/1008) leria o @ ou o BSUID como nome e
    // congelaria o card; nulo, o card nasce "Novo contato" e o nome chega depois.
    const id = identidadeNaEntrada(
      { from_user_id: BSUID },
      { user_id: BSUID, profile: { username: 'bia.silva' } },
    )
    expect(id.nome).toBeNull()
    expect(identidadeNaEntrada({ from_user_id: BSUID }).nome).toBeNull()
    expect(
      identidadeNaEntrada({ from_user_id: BSUID }, { user_id: BSUID, profile: { name: '   ' } }).nome,
    ).toBeNull()
  })

  it('`from` ou `wa_id` com LETRA não é telefone — os dígitos de um BSUID não viram celular', () => {
    expect(identidadeNaEntrada({ from: BSUID, from_user_id: BSUID }).telefone).toBeNull()
    expect(identidadeNaEntrada({ from_user_id: BSUID }, { wa_id: BSUID }).telefone).toBeNull()
  })

  it('normaliza o telefone para dígitos, como o banco', () => {
    expect(identidadeNaEntrada({ from: '+55 (83) 90000-0001' }).telefone).toBe('5583900000001')
  })

  it('sem telefone e sem BSUID, os dois ficam nulos (a rota descarta)', () => {
    const id = identidadeNaEntrada({}, { profile: { name: 'Ninguém' } })
    expect(id.telefone).toBeNull()
    expect(id.waUserId).toBeNull()
  })
})

describe('contatoDaMensagem — o pareamento pela identidade', () => {
  const ana = { wa_id: '5583900000001', user_id: 'BR.11111111111111111111', profile: { name: 'Ana' } }
  const bia = { wa_id: '5583900000002', user_id: 'BR.22222222222222222222', profile: { name: 'Bia' } }

  it('acha a entrada da mensagem em qualquer posição', () => {
    expect(contatoDaMensagem({ from: '5583900000002' }, [ana, bia], 0)).toBe(bia)
    expect(contatoDaMensagem({ from_user_id: 'BR.11111111111111111111' }, [bia, ana], 0)).toBe(ana)
  })

  it('NUNCA usa a entrada de outra pessoa — nem na posição, nem como a única', () => {
    // O BSUID de outra pessoa gravado nesta ficha seria para sempre: o
    // preenchimento só escreve em branco.
    expect(contatoDaMensagem({ from: '5583900000009' }, [ana], 0)).toBeUndefined()
    expect(contatoDaMensagem({ from: '5583900000001', from_user_id: 'BR.99999999999999999999' }, [ana], 0))
      .toBeUndefined()
    // …e por isso a identidade da mensagem não herda o BSUID dela.
    const id = identidadeNaEntrada({ from: '5583900000009' }, contatoDaMensagem({ from: '5583900000009' }, [ana], 0))
    expect(id.waUserId).toBeNull()
    expect(id.nome).toBeNull()
  })

  it('a entrada que casa pelo telefone traz o BSUID que a mensagem não trouxe', () => {
    const contato = contatoDaMensagem({ from: '5583900000001' }, [ana], 0)
    expect(identidadeNaEntrada({ from: '5583900000001' }, contato).waUserId).toBe('BR.11111111111111111111')
  })

  it('sem nada para comparar, só vale a entrada ÚNICA', () => {
    const soNome = { profile: { name: 'Ana' } }
    expect(contatoDaMensagem({ from_user_id: BSUID }, [soNome], 0)).toBe(soNome)
    expect(contatoDaMensagem({ from_user_id: BSUID }, [soNome, { profile: { name: 'Bia' } }], 0)).toBeUndefined()
  })

  it('sem contacts[] (ou vazio) não há entrada', () => {
    expect(contatoDaMensagem({ from: '5583900000001' }, undefined, 0)).toBeUndefined()
    expect(contatoDaMensagem({ from: '5583900000001' }, [], 0)).toBeUndefined()
  })
})
