import { describe, expect, it } from 'vitest'

import { resultadoDaAtribuicao } from './resultado-da-atribuicao'

describe('resultadoDaAtribuicao — o menu reflete o GRAVADO, nunca o pedido', () => {
  it('gravou quem foi pedido', () => {
    expect(resultadoDaAtribuicao('a1', [{ assigned_agent_id: 'a1' }])).toEqual({ tipo: 'ok', gravado: 'a1' })
  })

  it('tirar o responsável é ok', () => {
    expect(resultadoDaAtribuicao(null, [{ assigned_agent_id: null }])).toEqual({ tipo: 'ok', gravado: null })
  })

  it('o banco manteve o anterior (quem foi pedido não é mais membro)', () => {
    expect(resultadoDaAtribuicao('saiu', [{ assigned_agent_id: 'a1' }])).toEqual({
      tipo: 'recusada',
      gravado: 'a1',
    })
  })

  it('o banco deixou sem responsável (não havia anterior que ainda fosse membro)', () => {
    expect(resultadoDaAtribuicao('saiu', [{ assigned_agent_id: null }])).toEqual({
      tipo: 'recusada',
      gravado: null,
    })
  })

  it('0 linhas sem erro é FALHA: a RLS barrou (Visualizador) ou a conversa sumiu', () => {
    expect(resultadoDaAtribuicao('a1', [])).toEqual({ tipo: 'falhou' })
    expect(resultadoDaAtribuicao(null, null)).toEqual({ tipo: 'falhou' })
  })
})
