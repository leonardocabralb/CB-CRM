import { describe, expect, it } from 'vitest'

import { lerRespostaDaRetomada } from './retomada-resposta'

// ============================================================
// A resposta de uma RETOMADA (1056): o que sai ao cliente e o que PARA a
// série sem mandar nada. Nada executa e nada é transferido numa retomada.
// ============================================================

const FONTES = ['pedido', 'Oi! Você conseguiu ver os documentos?']

describe('lerRespostaDaRetomada', () => {
  it('texto comum: sai', () => {
    expect(lerRespostaDaRetomada('Oi! Conseguiu separar os extratos?', false, FONTES)).toEqual({
      parada: null,
      texto: 'Oi! Conseguiu separar os extratos?',
    })
  })

  it.each(['[[SEM_RETOMADA]]', ' [[ sem retomada ]] ', '[SEM-RETOMADA]', 'Tudo certo. [[SEM_RETOMADA]]'])(
    '%s: nada pendente, nada sai',
    (texto) => {
      expect(lerRespostaDaRetomada(texto, false, FONTES)).toEqual({ parada: 'nada_pendente' })
    },
  )

  it('o sentinela exato (`handoff` do gerador): para, sem transferir', () => {
    expect(lerRespostaDaRetomada('', true, FONTES)).toEqual({ parada: 'pediu_equipe' })
  })

  it.each(['[[ handoff ]]', 'Vou chamar a equipe. [[TRANSFERIR]]', '[[PASSAR:1]]'])(
    '%s: a equipe (ou outro agente) pedida: para',
    (texto) => {
      expect(lerRespostaDaRetomada(texto, false, FONTES).parada).toBe('pediu_equipe')
    },
  )

  it('a equipe prometida sem marcador: para, com o texto no detalhe', () => {
    const r = lerRespostaDaRetomada('Nossa equipe vai entrar em contato com você em breve.', false, FONTES)
    expect(r.parada).toBe('pediu_equipe')
  })

  it('só marcadores: sem texto, para', () => {
    expect(lerRespostaDaRetomada('[[MOVER:1]]', false, FONTES)).toEqual({ parada: 'sem_texto' })
  })

  it('marcador de ação sai do texto e não executa (a retomada não tem ações)', () => {
    expect(lerRespostaDaRetomada('Conseguiu ver? [[ETIQUETA:1]]', false, FONTES)).toEqual({ parada: null, texto: 'Conseguiu ver?' })
  })

  it('link que não veio do pedido nem da conversa: para, com o link no detalhe', () => {
    const r = lerRespostaDaRetomada('Veja aqui: https://inventado.example/x', false, FONTES)
    expect(r).toEqual({ parada: 'link_inventado', detalhe: 'https://inventado.example/x' })
  })

  it('link que veio da conversa: sai', () => {
    const r = lerRespostaDaRetomada('O link é https://calendly.com/cb/reuniao', false, [...FONTES, 'https://calendly.com/cb/reuniao'])
    expect(r.parada).toBeNull()
  })
})
