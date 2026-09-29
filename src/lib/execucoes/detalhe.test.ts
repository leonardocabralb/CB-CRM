import { describe, expect, it } from 'vitest'

import { DETALHE_DA_INTERRUPCAO } from '@/lib/automations/parar-se-responder'
import { MOTIVO_PASSO_MOVIDO } from '@/lib/automations/retomada'
import { DETALHE_SAIU_DA_ETAPA } from '@/lib/automations/so-na-etapa'
import { montarDetalhe, type EsperaEncerrada } from './detalhe'
import type { PassoDaAutomacao, PassoExecutado } from './linha-do-tempo'

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
    step_config: step_type === 'wait' ? { amount: 1, unit: 'days' } : { text: `msg ${id}` },
    parent_step_id: null,
    branch: null,
    ...extra,
  }
}

function rodou(
  step_id: string,
  status: PassoExecutado['status'] = 'success',
  detail = 'sent (x)',
  step_type = 'send_message',
): PassoExecutado {
  return { step_id, step_type, status, detail }
}

const noRamo = (cond: string, branch: 'yes' | 'no') => ({ parent_step_id: cond, branch })

describe('montarDetalhe — o que rodou', () => {
  it('lista o registro na ordem, com estado por status e o texto cru do motor', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('b', 1, 'add_tag')],
      executados: [rodou('a'), rodou('b', 'success', 'tag t already present', 'add_tag')],
      desfecho: 'concluida',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => [p.estado, p.chave, p.detalhe])).toEqual([
      ['feito', 'send_message', 'sent (x)'],
      ['feito', 'add_tag', 'tag t already present'],
    ])
    expect(d.naoRodaram).toBeNull()
  })

  it('passo apagado depois de rodar cai para o rótulo do tipo, sem sumir', () => {
    const d = montarDetalhe({
      passos: [],
      executados: [rodou('sumiu', 'success', 'webhook 200', 'send_webhook')],
      desfecho: 'concluida',
      esperasEncerradas: [],
    })
    expect(d.passos).toHaveLength(1)
    expect(d.passos[0].chave).toBe('send_webhook')
  })

  it('barrada: a condição que desviou aparece pulada, sem lista do que não rodou', () => {
    const d = montarDetalhe({
      passos: [passo('c', 0, 'condition')],
      executados: [rodou('c', 'skipped', 'branch=no', 'condition')],
      desfecho: 'barrada',
      esperasEncerradas: [],
    })
    expect(d.passos[0].estado).toBe('pulado')
    expect(d.naoRodaram).toBeNull()
  })
})

describe('montarDetalhe — falhou: onde parou e o que não rodou', () => {
  it('falha no meio: os passos seguintes do escopo não rodaram', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('b', 1, 'send_webhook'), passo('c', 2), passo('d', 3, 'condition')],
      executados: [rodou('a'), rodou('b', 'failed', 'webhook returned 404', 'send_webhook')],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.passos[1]).toMatchObject({ estado: 'falhou', parou: true })
    expect(d.naoRodaram?.map((p) => [p.id, p.estado])).toEqual([
      ['c', 'futuro'],
      ['d', 'condicional'],
    ])
  })

  it('falha no ÚLTIMO passo: nada ficou para trás (lista vazia, não nula)', () => {
    // O caso do "Contrato fechado" de 29/09: 12 passos feitos, o webhook final
    // voltou 404 — a lista vazia diz "era o último", e a tela não inventa nada.
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('w', 1, 'send_webhook')],
      executados: [rodou('a'), rodou('w', 'failed', 'webhook returned 404', 'send_webhook')],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.naoRodaram).toEqual([])
  })

  it('falha dentro de um RAMO encerra tudo: o que vinha depois da condição também não rodou', () => {
    const d = montarDetalhe({
      passos: [
        passo('cond', 0, 'condition'),
        passo('r1', 0, 'send_message', noRamo('cond', 'no')),
        passo('r2', 1, 'send_webhook', noRamo('cond', 'no')),
        passo('r3', 2, 'send_message', noRamo('cond', 'no')),
        passo('outro', 0, 'send_message', noRamo('cond', 'yes')),
        passo('depois', 1),
      ],
      executados: [
        rodou('cond', 'success', 'branch=no', 'condition'),
        rodou('r1'),
        rodou('r2', 'failed', 'webhook returned 500', 'send_webhook'),
      ],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    // O ramo "sim" não é afirmado: nunca rodaria nesta execução.
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['r3', 'depois'])
  })

  it('o que já rodou nunca aparece como "não rodou" (espera no ramo não segura o escopo de fora)', () => {
    // O ramo estacionou num "Aguardar"; o escopo de fora seguiu e rodou
    // `depois`; horas depois o ramo acordou e falhou.
    const d = montarDetalhe({
      passos: [
        passo('cond', 0, 'condition'),
        passo('espera', 0, 'wait', noRamo('cond', 'yes')),
        passo('r2', 1, 'send_message', noRamo('cond', 'yes')),
        passo('r3', 2, 'send_message', noRamo('cond', 'yes')),
        passo('depois', 1),
      ],
      executados: [
        rodou('cond', 'success', 'branch=yes', 'condition'),
        rodou('espera', 'success', 'waiting 1 days', 'wait'),
        rodou('depois'),
        rodou('r2', 'failed', 'Connection Closed'),
      ],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['r3'])
  })

  it('aviso de retentativa não é a falha que parou; a última falha é', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('b', 1)],
      executados: [
        rodou('a', 'failed', 'Connection Closed — tentativa 1 de 3; nova tentativa em 30s'),
        rodou('a', 'failed', 'Connection Closed — desisti depois de 3 tentativas'),
      ],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => [p.estado, p.parou ?? false])).toEqual([
      ['tentativa', false],
      ['falhou', true],
    ])
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['b'])
  })

  it('o passo que falhou não existe mais (automação editada): a lista não é afirmada', () => {
    const d = montarDetalhe({
      passos: [passo('novo', 0)],
      executados: [rodou('velho', 'failed', 'webhook returned 404', 'send_webhook')],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.naoRodaram).toBeNull()
    expect(d.naoRodaramDesconhecido).toBe(true)
  })

  it('falha AO ACORDAR (sem passo): o ponto de parada é a espera que falhou', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('w', 1, 'wait'), passo('b', 2), passo('c', 3)],
      executados: [
        rodou('a'),
        rodou('w', 'success', 'waiting 1 days', 'wait'),
        { step_id: '', step_type: 'wait', status: 'failed', detail: 'não consegui conferir…' },
      ],
      desfecho: 'falhou',
      esperasEncerradas: [
        { parent_step_id: null, branch: null, next_step_position: 2, context: { _passo_da_fila: { id: 'w', pos: 1 } } },
      ],
    })
    expect(d.passos[2]).toMatchObject({ estado: 'falhou', parou: true, doMotor: true })
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['b', 'c'])
  })
})

describe('montarDetalhe — interrompida', () => {
  const PASSOS = [passo('a', 0), passo('w', 1, 'wait'), passo('b', 2), passo('cond', 3, 'condition')]
  const ESPERA: EsperaEncerrada = {
    parent_step_id: null,
    branch: null,
    next_step_position: 2,
    context: { _passo_da_fila: { id: 'w', pos: 1 } },
  }

  it('a espera cancelada diz de onde a sequência não seguiu; a anotação não vira passo', () => {
    const d = montarDetalhe({
      passos: PASSOS,
      executados: [
        rodou('a'),
        rodou('w', 'success', 'waiting 1 days (para se o cliente responder)', 'wait'),
        { step_id: 'w', step_type: 'wait', status: 'skipped', detail: DETALHE_DA_INTERRUPCAO },
      ],
      desfecho: 'interrompida',
      esperasEncerradas: [ESPERA],
    })
    expect(d.passos.map((p) => p.id)).toEqual(['a-0', 'w-1'])
    expect(d.naoRodaram?.map((p) => [p.id, p.estado])).toEqual([
      ['b', 'futuro'],
      ['cond', 'condicional'],
    ])
  })

  it('usa a MESMA régua da retomada: passo inserido antes da espera desloca a posição', () => {
    // Depois da interrupção, alguém inseriu um passo no começo: tudo andou uma
    // posição. A posição crua (2) apontaria para `w`; a régua acha `b`.
    const editados = [passo('novo', 0), passo('a', 1), passo('w', 2, 'wait'), passo('b', 3)]
    const d = montarDetalhe({
      passos: editados,
      executados: [rodou('a'), rodou('w', 'success', 'waiting 1 days', 'wait')],
      desfecho: 'interrompida',
      esperasEncerradas: [ESPERA],
    })
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['b'])
  })

  it('o passo da espera foi removido depois: a lista não é afirmada', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('b', 1)],
      executados: [rodou('a')],
      desfecho: 'interrompida',
      esperasEncerradas: [ESPERA],
    })
    expect(d.naoRodaramDesconhecido).toBe(true)
  })

  it('interrompida enquanto rodava, sem espera: parte do passo "não executado"', () => {
    const d = montarDetalhe({
      passos: PASSOS,
      executados: [
        rodou('a'),
        { step_id: 'w', step_type: 'wait', status: 'skipped', detail: 'não executado: a execução já foi interrompida' },
      ],
      desfecho: 'interrompida',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => p.estado)).toEqual(['feito', 'pulado'])
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['w', 'b', 'cond'])
  })

  it('sem espera e sem passo "não executado": não há ponto de parada, e nada é afirmado', () => {
    const d = montarDetalhe({
      passos: PASSOS,
      executados: [rodou('a')],
      desfecho: 'interrompida',
      esperasEncerradas: [],
    })
    expect(d.naoRodaram).toBeNull()
    expect(d.naoRodaramDesconhecido).toBeUndefined()
  })

  it('duas esperas da mesma execução (ramo e escopo de fora): a lista junta as duas, sem repetir', () => {
    const passos = [
      passo('cond', 0, 'condition'),
      passo('wr', 0, 'wait', noRamo('cond', 'yes')),
      passo('r2', 1, 'send_message', noRamo('cond', 'yes')),
      passo('wf', 1, 'wait'),
      passo('f2', 2),
    ]
    const d = montarDetalhe({
      passos,
      executados: [
        rodou('cond', 'success', 'branch=yes', 'condition'),
        rodou('wr', 'success', 'waiting 1 days', 'wait'),
        rodou('wf', 'success', 'waiting 1 days', 'wait'),
      ],
      desfecho: 'interrompida',
      esperasEncerradas: [
        { parent_step_id: 'cond', branch: 'yes', next_step_position: 1, context: { _passo_da_fila: { id: 'wr', pos: 0 } } },
        { parent_step_id: null, branch: null, next_step_position: 2, context: { _passo_da_fila: { id: 'wf', pos: 1 } } },
      ],
    })
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['r2', 'f2'])
  })
})

describe('montarDetalhe — a ORDEM em que rodou (o ramo grava antes da condição)', () => {
  it('ramo cheio que falha: a ordem gravada pelo motor volta à ordem em que rodou', () => {
    // Plano: A (0) → C (1, condição) → D (2); no ramo "não": B1, B2, B3.
    // O motor grava o array do RAMO ao terminar (com a falha) e só depois o
    // de fora, com A e a condição: [B1, B2✗, A, C]. D nunca rodou.
    const d = montarDetalhe({
      passos: [
        passo('A', 0),
        passo('C', 1, 'condition'),
        passo('D', 2),
        passo('B1', 0, 'send_message', noRamo('C', 'no')),
        passo('B2', 1, 'send_webhook', noRamo('C', 'no')),
        passo('B3', 2, 'send_message', noRamo('C', 'no')),
      ],
      executados: [
        rodou('B1'),
        rodou('B2', 'failed', 'webhook returned 404', 'send_webhook'),
        rodou('A'),
        rodou('C', 'success', 'branch=no', 'condition'),
      ],
      desfecho: 'falhou',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => p.id.split('-')[0])).toEqual(['A', 'C', 'B1', 'B2'])
    expect(d.passos.at(-1)?.parou).toBe(true)
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['B3', 'D'])
  })

  it('espera no ramo: o trecho gravado ANTES da condição sobe, o da retomada fica depois do escopo de fora', () => {
    // Plano: C (0) → D (1); no ramo "sim": W (espera), B. O ramo estaciona e
    // grava [W]; o escopo de fora segue e grava [C, D]; horas depois a
    // retomada grava [B]. Rodou nesta ordem: C, W, D, B.
    const d = montarDetalhe({
      passos: [
        passo('C', 0, 'condition'),
        passo('D', 1),
        passo('W', 0, 'wait', noRamo('C', 'yes')),
        passo('B', 1, 'send_message', noRamo('C', 'yes')),
      ],
      executados: [
        rodou('W', 'success', 'waiting 1 days', 'wait'),
        rodou('C', 'success', 'branch=yes', 'condition'),
        rodou('D'),
        rodou('B'),
      ],
      desfecho: 'concluida',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => p.id.split('-')[0])).toEqual(['C', 'W', 'D', 'B'])
  })

  it('ramo dentro de ramo: cada trecho vai para depois da SUA condição', () => {
    const d = montarDetalhe({
      passos: [
        passo('C1', 0, 'condition'),
        passo('C2', 0, 'condition', noRamo('C1', 'yes')),
        passo('X', 0, 'send_message', noRamo('C2', 'no')),
      ],
      executados: [
        rodou('X'),
        rodou('C2', 'success', 'branch=no', 'condition'),
        rodou('C1', 'success', 'branch=yes', 'condition'),
      ],
      desfecho: 'concluida',
      esperasEncerradas: [],
    })
    expect(d.passos.map((p) => p.id.split('-')[0])).toEqual(['C1', 'C2', 'X'])
  })
})

describe('montarDetalhe — o revisor de 29/09', () => {
  it('envio recusado e reagendado, depois cancelado, NÃO saiu: aparece em "não rodaram"', () => {
    // A retentativa estaciona na posição do PRÓPRIO passo; o operador clicou
    // Parar antes da nova tentativa.
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('envio', 1)],
      executados: [
        rodou('a'),
        rodou('envio', 'failed', 'recusado — tentativa 1 de 3; nova tentativa em 30s'),
      ],
      desfecho: 'interrompida',
      esperasEncerradas: [
        { parent_step_id: null, branch: null, next_step_position: 1, context: { _passo_da_fila: { id: 'envio', pos: 1 } } },
      ],
    })
    expect(d.passos[1].estado).toBe('tentativa')
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['envio'])
  })

  it('a retomada que parou por passo MOVIDO é linha do motor, e a lista não é afirmada', () => {
    // O motor grava o id do passo que estacionou, com tipo `wait`; hoje ele
    // está noutro ramo — calcular a partir do escopo NOVO mentiria.
    const d = montarDetalhe({
      passos: [passo('cond', 0, 'condition'), passo('w', 0, 'wait', noRamo('cond', 'yes')), passo('b', 1)],
      executados: [
        rodou('w', 'success', 'waiting 1 days', 'wait'),
        { step_id: 'w', step_type: 'wait', status: 'failed', detail: MOTIVO_PASSO_MOVIDO },
      ],
      desfecho: 'falhou',
      esperasEncerradas: [
        { parent_step_id: null, branch: null, next_step_position: 1, context: { _passo_da_fila: { id: 'w', pos: 0 } } },
      ],
    })
    expect(d.passos[1]).toMatchObject({ doMotor: true, parou: true })
    expect(d.naoRodaramDesconhecido).toBe(true)
    expect(d.naoRodaram).toBeNull()
  })

  it('passo que rodou e saiu da automação depois: rótulo do tipo (`removido`), não "(apagado)"', () => {
    const d = montarDetalhe({
      passos: [],
      executados: [rodou('sumiu', 'success', 'tag x added and tag_added dispatched', 'add_tag')],
      desfecho: 'concluida',
      esperasEncerradas: [],
    })
    expect(d.passos[0]).toMatchObject({ removido: true, tipo: 'add_tag' })
    expect(d.passos[0].doMotor).toBeUndefined()
  })

  it('a guarda do motor "card saiu da etapa" num passo real é ponto de parada (sem espera na fila)', () => {
    const d = montarDetalhe({
      passos: [passo('a', 0), passo('b', 1), passo('c', 2)],
      executados: [rodou('a'), { step_id: 'b', step_type: 'send_message', status: 'skipped', detail: DETALHE_SAIU_DA_ETAPA }],
      desfecho: 'interrompida',
      esperasEncerradas: [],
    })
    // A anotação não vira passo (o rodapé diz o motivo)...
    expect(d.passos.map((p) => p.id)).toEqual(['a-0'])
    // ...mas diz de onde a sequência não seguiu.
    expect(d.naoRodaram?.map((p) => p.id)).toEqual(['b', 'c'])
  })
})
