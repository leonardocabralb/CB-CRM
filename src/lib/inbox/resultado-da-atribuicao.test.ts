import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

// O menu Responsável é quem usa a régua acima: sem estes pinos, voltar ao
// `.update().eq()` sem `.select()` deixaria tudo verde, e o menu afirmaria o
// pedido sobre 0 linhas (RLS) ou sobre o anterior mantido pelo gatilho (1148).
describe('o menu Responsável grava conferindo o retorno', () => {
  const fonte = readFileSync(
    join(process.cwd(), 'src/components/inbox/painel/responsavel-menu.tsx'),
    'utf8',
  )
  const inicio = fonte.indexOf('const atribuir = useCallback(')
  const atribuir = fonte.slice(inicio, fonte.indexOf('[conversationId, onAssignChange, t]', inicio))

  it('pede de volta o que gravou e passa pela régua', () => {
    expect(inicio).toBeGreaterThan(-1)
    expect(atribuir).toContain('.select("assigned_agent_id")')
    expect(atribuir).toContain('const resultado = resultadoDaAtribuicao(agentId, data)')
  })

  it('falhou = aviso e nada muda; recusada = aviso e a lista relida; a tela recebe o GRAVADO', () => {
    expect(atribuir).toMatch(/if \(resultado\.tipo === "falhou"\) \{\s+toast\.error\(t\("assignUpdateFailed"\)\);\s+return;/)
    expect(atribuir).toMatch(/if \(resultado\.tipo === "recusada"\) \{\s+toast\.error\(t\("assigneeNoLongerMember"\)\);\s+setVersaoDaLista\(\(v\) => v \+ 1\);/)
    expect(atribuir).toContain('onAssignChange(conversationId, resultado.gravado)')
    expect(atribuir).not.toContain('onAssignChange(conversationId, agentId)')
  })
})
