import { describe, expect, it } from 'vitest'
import type { Automation } from '@/types'

import { triggerMatches } from './engine'
import {
  automacoesDaEtapa,
  classificarNaEtapa,
  contarAtivasNaEtapa,
} from './por-etapa'

// ------------------------------------------------------------
// O painel por etapa (Fase 5).
//
// O risco central desta tela é dizer uma coisa e o motor fazer outra: a
// automação de gatilho VAZIO dispara em toda etapa, e um painel que só
// listasse quem nomeia a coluna mostraria "nenhuma automação" numa etapa que
// tem regra ativa. Por isso os testes abaixo comparam com `triggerMatches` de
// verdade, e não com a ideia que eu tenho dele.
// ------------------------------------------------------------

const auto = (over: Partial<Automation> = {}): Automation =>
  ({
    id: 'a1',
    name: 'x',
    trigger_type: 'deal_stage_changed',
    trigger_config: {},
    is_active: true,
    ...over,
  }) as unknown as Automation

describe('classificarNaEtapa', () => {
  it('gatilho que NOMEIA a etapa é específico', () => {
    expect(
      classificarNaEtapa(auto({ trigger_config: { stage_ids: ['st-1'] } }), 'st-1'),
    ).toBe('especifica')
  })

  it('CRÍTICO: gatilho vazio é irrestrito, não "fora"', () => {
    // Se isto virar 'fora', a coluna passa a mostrar "0 automações" enquanto o
    // motor dispara uma a cada card que entra. É o defeito que o painel
    // inteiro existe para não ter.
    expect(classificarNaEtapa(auto({ trigger_config: {} }), 'st-1')).toBe('irrestrita')
    expect(
      classificarNaEtapa(auto({ trigger_config: { stage_ids: [] } }), 'st-1'),
    ).toBe('irrestrita')
  })

  it('config que não é lista conta como vazia', () => {
    // Escrita à mão pela API pública, ou resto de uma versão anterior.
    expect(
      classificarNaEtapa(
        auto({ trigger_config: { stage_ids: 'st-1' } as never }),
        'st-1',
      ),
    ).toBe('irrestrita')
  })

  it('gatilho que nomeia OUTRA etapa fica de fora', () => {
    expect(
      classificarNaEtapa(auto({ trigger_config: { stage_ids: ['st-2'] } }), 'st-1'),
    ).toBe('fora')
  })

  it('outro tipo de gatilho fica de fora', () => {
    // Uma automação de palavra-chave com escopo nesta etapa também roda aqui,
    // mas não por ENTRAR na etapa — e o painel promete "quando o card cai
    // aqui". Misturar as duas leituras é o que faz o operador desativar a
    // regra errada.
    expect(
      classificarNaEtapa(
        auto({ trigger_type: 'keyword_match', stage_ids: ['st-1'] }),
        'st-1',
      ),
    ).toBe('fora')
  })

  it('CRÍTICO: gatilho alcança mas o ESCOPO barra → morta', () => {
    // Alcançável pela tela: basta escolher um escopo de etapa com outro
    // gatilho e depois trocar o gatilho para "mudou de etapa" — o seletor de
    // escopo some, o valor fica.
    expect(
      classificarNaEtapa(
        auto({ trigger_config: { stage_ids: ['st-1'] }, stage_ids: ['st-2'] }),
        'st-1',
      ),
    ).toBe('morta')
  })

  it('irrestrita com escopo em outra etapa também é morta ali', () => {
    expect(
      classificarNaEtapa(auto({ trigger_config: {}, stage_ids: ['st-2'] }), 'st-1'),
    ).toBe('morta')
  })

  it('escopo que INCLUI a etapa não mata', () => {
    expect(
      classificarNaEtapa(
        auto({ trigger_config: { stage_ids: ['st-1'] }, stage_ids: ['st-1', 'st-9'] }),
        'st-1',
      ),
    ).toBe('especifica')
  })

  it('escopo nulo/vazio deixa passar', () => {
    expect(
      classificarNaEtapa(
        auto({ trigger_config: { stage_ids: ['st-1'] }, stage_ids: null }),
        'st-1',
      ),
    ).toBe('especifica')
    expect(
      classificarNaEtapa(
        auto({ trigger_config: { stage_ids: ['st-1'] }, stage_ids: [] }),
        'st-1',
      ),
    ).toBe('especifica')
  })
})

// ------------------------------------------------------------
// A trava contra divergência: o painel e o motor têm de concordar sobre QUEM
// dispara. Aqui a comparação é com a função de verdade, importada do
// `engine.ts` — se alguém mudar a regra lá, este teste quebra aqui.
// ------------------------------------------------------------

describe('concorda com triggerMatches do motor', () => {
  const configs: Array<Record<string, unknown>> = [
    {},
    { stage_ids: [] },
    { stage_ids: ['st-1'] },
    { stage_ids: ['st-2'] },
    { stage_ids: ['st-1', 'st-2'] },
  ]

  it.each(configs)('config %j', (cfg) => {
    for (const etapa of ['st-1', 'st-2', 'st-3']) {
      const a = auto({ trigger_config: cfg })
      const motor = triggerMatches(a, { to_stage_id: etapa })
      // Sem escopo, "não é fora" tem de ser exatamente o que o motor diz.
      const painel = classificarNaEtapa(a, etapa) !== 'fora'
      expect(painel).toBe(motor)
    }
  })
})

describe('automacoesDaEtapa', () => {
  const lista = [
    auto({ id: 'espec', trigger_config: { stage_ids: ['st-1'] } }),
    auto({ id: 'todas', trigger_config: {} }),
    auto({ id: 'outra', trigger_config: { stage_ids: ['st-9'] } }),
    auto({
      id: 'morta',
      trigger_config: { stage_ids: ['st-1'] },
      stage_ids: ['st-9'],
    }),
    auto({ id: 'keyword', trigger_type: 'keyword_match' }),
  ]

  it('separa nos três grupos e descarta o resto', () => {
    const r = automacoesDaEtapa(lista, 'st-1')
    expect(r.especificas.map((a) => a.id)).toEqual(['espec'])
    expect(r.irrestritas.map((a) => a.id)).toEqual(['todas'])
    expect(r.mortas.map((a) => a.id)).toEqual(['morta'])
  })

  it('lista vazia devolve os três grupos vazios, não undefined', () => {
    const r = automacoesDaEtapa([], 'st-1')
    expect(r).toEqual({ especificas: [], irrestritas: [], mortas: [] })
  })
})

describe('contarAtivasNaEtapa', () => {
  it('soma específicas e irrestritas', () => {
    expect(
      contarAtivasNaEtapa(
        [
          auto({ id: '1', trigger_config: { stage_ids: ['st-1'] } }),
          auto({ id: '2', trigger_config: {} }),
        ],
        'st-1',
      ),
    ).toBe(2)
  })

  it('CRÍTICO: não conta a pausada', () => {
    // Etiqueta "2" numa coluna onde nada acontece manda o operador caçar
    // defeito no motor.
    expect(
      contarAtivasNaEtapa(
        [
          auto({ id: '1', trigger_config: { stage_ids: ['st-1'] }, is_active: false }),
          auto({ id: '2', trigger_config: {} }),
        ],
        'st-1',
      ),
    ).toBe(1)
  })

  it('não conta a morta', () => {
    expect(
      contarAtivasNaEtapa(
        [
          auto({
            id: 'morta',
            trigger_config: { stage_ids: ['st-1'] },
            stage_ids: ['st-9'],
          }),
        ],
        'st-1',
      ),
    ).toBe(0)
  })
})
