import { describe, expect, it } from 'vitest'

import { agruparEsperas, type EsperaPendente } from './agrupar'

function linha(
  automationId: string,
  runAt: string,
  automations: EsperaPendente['automations'] = { name: `Auto ${automationId}` },
): EsperaPendente {
  return {
    id: `${automationId}-${runAt}`,
    automation_id: automationId,
    run_at: runAt,
    automations,
  }
}

describe('agruparEsperas', () => {
  it('vazio devolve vazio', () => {
    expect(agruparEsperas([])).toEqual([])
  })

  it('agrupa por automação e conta as esperas', () => {
    const grupos = agruparEsperas([
      linha('a', '2026-09-02T12:00:00Z'),
      linha('a', '2026-09-05T12:00:00Z'),
      linha('b', '2026-09-01T08:00:00Z'),
    ])
    expect(grupos).toHaveLength(2)
    expect(grupos.find((g) => g.automationId === 'a')?.esperas).toBe(2)
    expect(grupos.find((g) => g.automationId === 'b')?.esperas).toBe(1)
  })

  it('proximaEm é a espera mais PRÓXIMA, independente da ordem das linhas', () => {
    const grupos = agruparEsperas([
      linha('a', '2026-09-05T12:00:00Z'),
      linha('a', '2026-09-02T12:00:00Z'),
      linha('a', '2026-09-09T12:00:00Z'),
    ])
    expect(grupos[0].proximaEm).toBe('2026-09-02T12:00:00Z')
  })

  it('ordena os grupos pela próxima batida — a mais iminente primeiro', () => {
    const grupos = agruparEsperas([
      linha('tarde', '2026-09-09T12:00:00Z'),
      linha('cedo', '2026-09-01T12:00:00Z'),
    ])
    expect(grupos.map((g) => g.automationId)).toEqual(['cedo', 'tarde'])
  })

  it('embed em ARRAY (forma defensiva) também resolve o nome', () => {
    const grupos = agruparEsperas([
      linha('a', '2026-09-02T12:00:00Z', [{ name: 'Follow-up' }]),
    ])
    expect(grupos[0].nome).toBe('Follow-up')
  })

  it('embed ausente vira nome null (automação apagada), sem estourar', () => {
    const grupos = agruparEsperas([linha('a', '2026-09-02T12:00:00Z', null)])
    expect(grupos[0].nome).toBeNull()
  })

  it('nome chega mesmo quando só parte das linhas trouxe o embed', () => {
    const grupos = agruparEsperas([
      linha('a', '2026-09-02T12:00:00Z', null),
      linha('a', '2026-09-05T12:00:00Z', { name: 'Cobrança' }),
    ])
    expect(grupos[0].nome).toBe('Cobrança')
  })

  it('a referência acompanha a espera mais PRÓXIMA, não a última lida', () => {
    const tarde: EsperaPendente = {
      ...linha('a', '2026-09-09T12:00:00Z'),
      next_step_position: 7,
      log_id: 'log-tarde',
    }
    const cedo: EsperaPendente = {
      ...linha('a', '2026-09-02T12:00:00Z'),
      next_step_position: 2,
      parent_step_id: 'cond-1',
      branch: 'yes',
      log_id: 'log-cedo',
    }
    const grupos = agruparEsperas([tarde, cedo])
    expect(grupos[0].proximaEm).toBe('2026-09-02T12:00:00Z')
    expect(grupos[0].referencia).toEqual({
      next_step_position: 2,
      parent_step_id: 'cond-1',
      branch: 'yes',
      log_id: 'log-cedo',
    })
  })
})
