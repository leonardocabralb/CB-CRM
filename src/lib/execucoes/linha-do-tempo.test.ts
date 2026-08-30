import { describe, expect, it } from 'vitest'

import {
  montarLinhaDoTempo,
  type PassoDaAutomacao,
  type PassoExecutado,
} from './linha-do-tempo'

function passo(
  id: string,
  position: number,
  step_type = 'send_message',
  extra: Partial<PassoDaAutomacao> = {},
): PassoDaAutomacao {
  return {
    id,
    position,
    step_type,
    step_config: { text: `msg ${id}` },
    parent_step_id: null,
    branch: null,
    ...extra,
  }
}

function executado(
  step_id: string,
  status: PassoExecutado['status'] = 'success',
  detail = 'ok',
): PassoExecutado {
  return { step_id, step_type: 'send_message', status, detail }
}

// Automação típica: mensagem (0) → aguardar (1) → mensagem (2) → condição (3).
// A espera parou no wait da posição 1; o resume aponta para a 2.
const PASSOS = [
  passo('p0', 0),
  passo('p1', 1, 'wait', { step_config: { amount: 30, unit: 'days' } }),
  passo('p2', 2),
  passo('p3', 3, 'condition', { step_config: {} }),
]
const ESPERA = { next_step_position: 2, parent_step_id: null, branch: null }

describe('montarLinhaDoTempo', () => {
  it('feitos vêm do log, na ordem, com detalhe e estado por status', () => {
    const { feitos } = montarLinhaDoTempo({
      passos: PASSOS,
      espera: ESPERA,
      executados: [
        executado('p0'),
        { step_id: 'p1', step_type: 'wait', status: 'success', detail: 'espera agendada' },
      ],
    })
    expect(feitos).toHaveLength(2)
    expect(feitos[0].estado).toBe('feito')
    expect(feitos[0].detalhe).toBe('ok')
    expect(feitos[1].chave).toBe('wait_days')
  })

  it('falha e pulo viram estados próprios', () => {
    const { feitos } = montarLinhaDoTempo({
      passos: PASSOS,
      espera: ESPERA,
      executados: [executado('p0', 'failed'), executado('p2', 'skipped')],
    })
    expect(feitos.map((f) => f.estado)).toEqual(['falhou', 'pulado'])
  })

  it('passo executado que foi APAGADO depois ainda aparece, pelo tipo', () => {
    const { feitos } = montarLinhaDoTempo({
      passos: PASSOS,
      espera: ESPERA,
      executados: [{ step_id: 'sumiu', step_type: 'add_tag', status: 'success' }],
    })
    expect(feitos[0].chave).toBe('add_tag')
    // Sem config e sem mapa de nomes, o alvo sumiu — é o "(apagado)" da tela.
    expect(feitos[0].alvoSumiu).toBe(true)
  })

  it('próximos são os do MESMO escopo a partir de next_step_position', () => {
    const { proximos } = montarLinhaDoTempo({
      passos: PASSOS,
      espera: ESPERA,
      executados: [],
    })
    expect(proximos.map((p) => p.id)).toEqual(['p2', 'p3'])
  })

  it('condição futura vira `condicional`; os passos DENTRO do ramo ficam fora', () => {
    const comRamo = [
      ...PASSOS,
      passo('filho-sim', 0, 'send_message', { parent_step_id: 'p3', branch: 'yes' }),
    ]
    const { proximos } = montarLinhaDoTempo({
      passos: comRamo,
      espera: ESPERA,
      executados: [],
    })
    expect(proximos.find((p) => p.id === 'p3')?.estado).toBe('condicional')
    expect(proximos.some((p) => p.id === 'filho-sim')).toBe(false)
  })

  it('espera parada DENTRO de um ramo lista só os irmãos do ramo', () => {
    const comRamo = [
      ...PASSOS,
      passo('ramo-0', 0, 'wait', { parent_step_id: 'p3', branch: 'yes' }),
      passo('ramo-1', 1, 'add_tag', { parent_step_id: 'p3', branch: 'yes', step_config: { tag_id: 't1' } }),
    ]
    const { proximos } = montarLinhaDoTempo({
      passos: comRamo,
      espera: { next_step_position: 1, parent_step_id: 'p3', branch: 'yes' },
      executados: [],
      nomes: { tags: { t1: 'VIP' } },
    })
    expect(proximos.map((p) => p.id)).toEqual(['ramo-1'])
    expect(proximos[0].valores.alvo).toBe('VIP')
    expect(proximos[0].alvoSumiu).toBe(false)
  })

  it('nada depois da espera = próximos vazio (a automação termina ali)', () => {
    const { proximos } = montarLinhaDoTempo({
      passos: PASSOS.slice(0, 2),
      espera: ESPERA,
      executados: [],
    })
    expect(proximos).toEqual([])
  })
})
