import { describe, it, expect } from 'vitest'
import { patchDeSituacao } from './situacao'

describe('patchDeSituacao — quem reabre fica responsável; encerrar solta', () => {
  it('reabrir uma encerrada atribui a quem reabriu', () => {
    expect(patchDeSituacao('closed', 'open', 'ana')).toEqual({
      status: 'open',
      assigned_agent_id: 'ana',
    })
    expect(patchDeSituacao('closed', 'pending', 'ana')).toEqual({
      status: 'pending',
      assigned_agent_id: 'ana',
    })
  })

  it('encerrar solta o responsável, de qualquer situação', () => {
    expect(patchDeSituacao('open', 'closed', 'ana')).toEqual({
      status: 'closed',
      assigned_agent_id: null,
    })
    expect(patchDeSituacao('pending', 'closed', 'ana')).toEqual({
      status: 'closed',
      assigned_agent_id: null,
    })
  })

  it('aberta ↔ pendente não é reabertura: a atribuição fica como está', () => {
    expect(patchDeSituacao('open', 'pending', 'ana')).toEqual({ status: 'pending' })
    expect(patchDeSituacao('pending', 'open', 'ana')).toEqual({ status: 'open' })
  })
})
