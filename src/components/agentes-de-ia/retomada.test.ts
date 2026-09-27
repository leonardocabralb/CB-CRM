import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { useTranslations } from 'next-intl'

import { lerRetomadaSimulada } from './ferramentas'
import { acrescentarIntervalo, retomadaMudou } from './rascunho'
import { PARADAS_DA_RETOMADA, textoDaParadaDaRetomada, textoDoIntervalo } from './textos'

// ============================================================
// A retomada (1056) do lado da TELA: o rascunho da sub-aba, o parse da
// simulação do Playground e as chaves MONTADAS (que escapam do portão de
// i18n do CI).
// ============================================================

const BASE = { ativa: true, cadencia: [15, 60, 180], janela: { inicio: '08:00', fim: '21:00' } }

describe('retomadaMudou', () => {
  it('igual: não mudou', () => {
    expect(retomadaMudou(BASE, { ...BASE, cadencia: [15, 60, 180], janela: { ...BASE.janela } })).toBe(false)
  })

  it.each<[string, typeof BASE]>([
    ['o interruptor', { ...BASE, ativa: false }],
    ['a cadência', { ...BASE, cadencia: [15, 60] }],
    ['um intervalo', { ...BASE, cadencia: [15, 60, 240] }],
    ['a janela', { ...BASE, janela: { inicio: '09:00', fim: '21:00' } }],
  ])('%s: mudou', (_rotulo, r) => {
    expect(retomadaMudou(BASE, r)).toBe(true)
  })
})

describe('acrescentarIntervalo', () => {
  it('acrescenta na ORDEM (a cadência é crescente)', () => {
    expect(acrescentarIntervalo([15, 180], '1', 'h')).toEqual({ ok: true, cadencia: [15, 60, 180] })
    expect(acrescentarIntervalo([15], '2', 'd')).toEqual({ ok: true, cadencia: [15, 2880] })
    expect(acrescentarIntervalo([60], '30', 'min')).toEqual({ ok: true, cadencia: [30, 60] })
  })

  it('1,5 h vira 90 min', () => {
    expect(acrescentarIntervalo([], '1,5', 'h')).toEqual({ ok: true, cadencia: [90] })
  })

  it.each<[string, string, 'min' | 'h' | 'd']>([
    ['vazio', '', 'h'],
    ['menos de 10 min', '5', 'min'],
    ['mais de 7 dias', '8', 'd'],
    ['texto', 'abc', 'h'],
    ['fração de minuto', '10.5', 'min'],
  ])('%s: inválido', (_rotulo, valor, unidade) => {
    expect(acrescentarIntervalo([15], valor, unidade)).toEqual({ ok: false, motivo: 'invalido' })
  })

  it('repetido e cadência cheia', () => {
    expect(acrescentarIntervalo([15, 60], '1', 'h')).toEqual({ ok: false, motivo: 'repetido' })
    expect(acrescentarIntervalo([10, 20, 30, 40, 50, 60, 70, 80], '2', 'h')).toEqual({ ok: false, motivo: 'cheia' })
  })
})

describe('lerRetomadaSimulada (a resposta do Playground)', () => {
  it('com texto, sem parada', () => {
    expect(lerRetomadaSimulada({ tentativa: 1, de: 6, texto: 'Oi!', parada: null })).toEqual({ tentativa: 1, de: 6, texto: 'Oi!', parada: null })
  })

  it('com parada: sem texto, com o motivo (mesmo desconhecido)', () => {
    expect(lerRetomadaSimulada({ tentativa: 2, de: 6, texto: 'x', parada: 'nada_pendente' })).toEqual({
      tentativa: 2,
      de: 6,
      texto: '',
      parada: 'nada_pendente',
    })
    expect(lerRetomadaSimulada({ tentativa: 2, de: 6, texto: '', parada: 'motivo_novo' })?.parada).toBe('motivo_novo')
  })

  it.each([null, 'x', { tentativa: 0, de: 6, texto: 'x' }, { tentativa: 1, de: 'x', texto: 'x' }, { tentativa: 1, de: 6, texto: '  ', parada: null }])(
    'forma estranha: null',
    (v) => {
      expect(lerRetomadaSimulada(v)).toBeNull()
    },
  )
})

describe('textos da retomada', () => {
  const t = ((chave: string, v?: Record<string, unknown>) => (v ? `${chave}|${JSON.stringify(v)}` : chave)) as unknown as ReturnType<
    typeof useTranslations
  >

  it('o intervalo pela unidade', () => {
    expect(textoDoIntervalo(t, 15)).toBe('retomada.unidade.min|{"n":15}')
    expect(textoDoIntervalo(t, 2880)).toBe('retomada.unidade.h|{"n":48}')
    expect(textoDoIntervalo(t, 10080)).toBe('retomada.unidade.d|{"n":7}')
  })

  it('a parada conhecida e a desconhecida (nunca a chave crua de um motivo novo)', () => {
    expect(textoDaParadaDaRetomada(t, 'pediu_equipe')).toBe('playground.retomadaParada.pediu_equipe')
    expect(textoDaParadaDaRetomada(t, 'motivo_novo')).toBe('playground.retomadaParadaDesconhecida')
    expect(textoDaParadaDaRetomada(t, 'toString')).toBe('playground.retomadaParadaDesconhecida')
  })
})

type Dic = { IaAgentes: Record<string, unknown> }
function em(obj: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

describe.each(['en.json', 'pt-BR.json'])('as chaves montadas da retomada em %s', (arquivo) => {
  const d = (JSON.parse(readFileSync(join(process.cwd(), 'messages', arquivo), 'utf8')) as Dic).IaAgentes

  it('cada unidade tem o texto e o nome do botão', () => {
    for (const u of ['min', 'h', 'd']) {
      expect(em(d, `retomada.unidade.${u}`), u).toBeTruthy()
      expect(em(d, `retomada.unidadeNome.${u}`), u).toBeTruthy()
    }
  })

  it('cada parada da simulação tem texto, e a desconhecida também', () => {
    for (const p of Object.keys(PARADAS_DA_RETOMADA)) expect(em(d, `playground.retomadaParada.${p}`), p).toBeTruthy()
    expect(em(d, 'playground.retomadaParadaDesconhecida')).toBeTruthy()
  })
})
