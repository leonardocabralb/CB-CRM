import { describe, expect, it } from 'vitest'

import { fromServerSteps, toApiSteps, type ServerStepNode } from './automation-builder'

// ============================================================
// O construtor devolve o id de BANCO de cada passo ao salvar (26/09/2026).
// Até aqui `fromServerSteps` descartava o id e `toApiSteps` não o mandava:
// todo salvamento recriava os passos, e a espera parada num ramo perdia a
// condição (FK `ON DELETE SET NULL`) — a retomada rodava o escopo de fora.
// ============================================================

const node = (id: string, step_type: string, filhos: ServerStepNode[] = []): ServerStepNode => ({
  id,
  step_type,
  step_config: { de: id },
  branches: { yes: filhos, no: [] },
})

describe('ids dos passos no construtor', () => {
  it('CRÍTICO: carregar e salvar sem mexer devolve os MESMOS ids, na mesma árvore', () => {
    const doServidor = [
      node('cond', 'condition', [node('espera', 'wait'), node('msg', 'send_message')]),
      node('fora', 'send_message'),
    ]
    const api = toApiSteps(fromServerSteps(doServidor))
    expect(api.map((s) => s.id)).toEqual(['cond', 'fora'])
    expect(api[0].branches?.yes?.map((s) => s.id)).toEqual(['espera', 'msg'])
  })

  it('passo sem id (o navegador sem randomUUID) vai sem a chave — o servidor atribui', () => {
    const [s] = toApiSteps([{ cid: 'c_1', step_type: 'send_message', step_config: {} }])
    expect('id' in s).toBe(false)
  })
})
