import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  IDS_POR_CONSULTA,
  idsCitados,
  lotesDeIds,
  textoComNomes,
  TIPOS_DO_ALVO,
  type NomesDoRegistro,
  type TipoDoAlvo,
} from './registro-legivel'

// Os textos abaixo são os que o motor grava de verdade (medidos em
// `automation_logs.steps_executed`, 25/09/2026).

const ETAPA = '3ab137e6-1be6-439e-a88d-3b66ac59dee7'
const TAG = '32f2da4f-765d-4be1-9496-eec52528c356'
const MEMBRO = '582aad06-4836-4865-b850-0466fff8bc7d'
const CAMPO = 'e40ad0f2-4cfe-40b8-96f1-556ceace452e'
const SUMIU = '00000000-1111-4222-8333-444444444444'

const TODOS: ReadonlySet<TipoDoAlvo> = new Set(TIPOS_DO_ALVO)

const NOMES: NomesDoRegistro = {
  porId: {
    [ETAPA]: 'Bancário - Comercial › Reunião Agendada',
    [TAG]: 'Typebot',
    [MEMBRO]: 'Leonardo Cabral Baptista',
    [CAMPO]: 'Data e Hora Reunião',
  },
  carregados: TODOS,
}

const ORFAO = (tipo: TipoDoAlvo) => `(${tipo} apagada)`

describe('textoComNomes', () => {
  it('troca a etapa, a etiqueta e o membro pelo nome, entre aspas', () => {
    expect(textoComNomes(`negócio movido para ${ETAPA}`, NOMES, 'move_deal_stage', ORFAO)).toBe(
      'negócio movido para "Bancário - Comercial › Reunião Agendada"',
    )
    expect(textoComNomes(`tag ${TAG} added and tag_added dispatched`, NOMES, 'add_tag', ORFAO)).toBe(
      'tag "Typebot" added and tag_added dispatched',
    )
    expect(textoComNomes(`assigned to ${MEMBRO}`, NOMES, 'assign_conversation', ORFAO)).toBe(
      'assigned to "Leonardo Cabral Baptista"',
    )
  })

  it('o campo personalizado leva o prefixo `custom:` junto', () => {
    expect(
      textoComNomes(`field custom:${CAMPO} not writable from automations`, NOMES, 'update_contact_field', ORFAO),
    ).toBe('field "Data e Hora Reunião" not writable from automations')
  })

  it('id em maiúsculas também casa', () => {
    expect(textoComNomes(`tag ${TAG.toUpperCase()} removed`, NOMES, 'remove_tag', ORFAO)).toBe('tag "Typebot" removed')
  })

  it('CRÍTICO: id que não existe mais vira o rótulo do órfão, nunca o UUID', () => {
    expect(textoComNomes(`negócio movido para ${SUMIU}`, NOMES, 'move_deal_stage', ORFAO)).toBe(
      'negócio movido para (etapa apagada)',
    )
    expect(textoComNomes(`${`custom:${SUMIU}`} not updated: empty value`, NOMES, 'update_contact_field', ORFAO)).toBe(
      '(campo apagada) not updated: empty value',
    )
  })

  it('CRÍTICO: catálogo que NÃO carregou não autoriza dizer "apagada" — o id fica', () => {
    const semEtapas: NomesDoRegistro = { porId: {}, carregados: new Set(['etiqueta']) }
    expect(textoComNomes(`negócio movido para ${ETAPA}`, semEtapas, 'move_deal_stage', ORFAO)).toBe(
      `negócio movido para ${ETAPA}`,
    )
  })

  it('id desconhecido num passo sem alvo conhecido (ou no erro da execução) fica como está', () => {
    expect(textoComNomes(`conversa ${SUMIU} não é desta conta`, NOMES, null, ORFAO)).toBe(
      `conversa ${SUMIU} não é desta conta`,
    )
    expect(textoComNomes(`algo ${SUMIU}`, NOMES, 'send_webhook', ORFAO)).toBe(`algo ${SUMIU}`)
  })

  it('texto sem id, e os ids de mensagem do WhatsApp, passam intactos', () => {
    const enviado = 'sent to 5583988745316 (3EB047485621586398652B)'
    expect(textoComNomes(enviado, NOMES, 'send_to_number', ORFAO)).toBe(enviado)
    expect(textoComNomes('deal already existed', NOMES, 'create_deal', ORFAO)).toBe('deal already existed')
  })
})

describe('idsCitados', () => {
  it('junta os ids de vários textos, sem repetir, em minúsculas', () => {
    expect(
      idsCitados([`tag ${TAG} added`, null, `tag ${TAG.toUpperCase()} removed`, `movido para ${ETAPA}`, undefined]).sort(),
    ).toEqual([TAG, ETAPA].sort())
  })

  it('texto sem id não devolve nada', () => {
    expect(idsCitados(['name updated', 'sent to 5583988745316 (3EB0474856)'])).toEqual([])
  })
})

// O rótulo do órfão é pedido por chave MONTADA (`orfao.${tipo}`), fora do
// alcance do portão de i18n do CI: sem este teste, um tipo novo mostraria a
// chave crua na tela.
describe.each(['pt-BR.json', 'en.json'])('dicionário %s', (arquivo) => {
  it('todo tipo de alvo tem o rótulo do órfão', () => {
    const logs = JSON.parse(readFileSync(`messages/${arquivo}`, 'utf8')).Automations.logs
    const faltando = TIPOS_DO_ALVO.filter((t) => typeof logs?.orfao?.[t] !== 'string' || !logs.orfao[t].trim())
    expect(faltando).toEqual([])
  })
})

describe('lotesDeIds', () => {
  it('fatia em lotes do tamanho da consulta, sem perder nem repetir id', () => {
    const ids = Array.from({ length: 123 }, (_, i) => `id-${i}`)
    const lotes = lotesDeIds(ids)
    expect(lotes.map((l) => l.length)).toEqual([IDS_POR_CONSULTA, IDS_POR_CONSULTA, 23])
    expect(lotes.flat()).toEqual(ids)
  })

  it('lista vazia não gera consulta', () => {
    expect(lotesDeIds([])).toEqual([])
  })

  it('o lote cabe na URL: 50 UUIDs ficam bem abaixo de 8 mil caracteres', () => {
    const uuid = '3ab137e6-1be6-439e-a88d-3b66ac59dee7'
    const lote = lotesDeIds(Array.from({ length: 500 }, () => uuid))[0]
    expect(`in.(${lote.join(',')})`.length).toBeLessThan(2500)
  })
})
