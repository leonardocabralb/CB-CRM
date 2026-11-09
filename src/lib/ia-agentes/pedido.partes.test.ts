import { describe, expect, it } from 'vitest'

import {
  juntarPartes,
  montarPedidoDaRetomada,
  montarPedidoDoAgente,
  partesDoPedidoDaRetomada,
  partesDoPedidoDoAgente,
  type ArgsDoPedido,
} from './pedido'
import { CANARIO_DAS_REGRAS, TRECHOS_DO_PEDIDO } from './regras-do-sistema'

// ============================================================
// O pedido em PARTES (09/11/2026, `.claude/rules/ia-cache-do-pedido.md`): o
// provedor só reaproveita o COMEÇO idêntico do pedido, então o que muda de
// turno em turno (data com minuto, blocos do cliente, base, horários, nota da
// agenda) vai para a parte VARIÁVEL, no fim. O que este arquivo segura:
// 1. juntas, as partes SÃO o pedido (Playground e travas leem o texto inteiro);
// 2. as partes FIXAS não mudam com a hora, o cliente, a base nem a agenda —
//    um dado variável nelas faria o cache errar em TODA chamada, sem erro;
// 3. a retomada divide a parte fixa do agente com o turno (o mesmo cache).
// ============================================================

const HORARIOS = {
  marcar_reuniao: [
    { id: '2026-11-10T18:15:00.000Z', nome: '10/11/2026 15:15', textoNoPedido: 'Tue 10/11 15:15' },
    { id: '2026-11-11T13:00:00.000Z', nome: '11/11/2026 10:00', textoNoPedido: 'Wed 11/11 10:00' },
  ],
}

function args(over: Partial<ArgsDoPedido> = {}): ArgsDoPedido {
  return {
    instrucoes: 'Você faz a triagem.',
    regras: ['Nunca prometa resultado.'],
    conduzFechamento: false,
    agora: new Date('2026-11-09T14:05:00Z'),
    passagens: [{ nome: 'Cobrança', descricao: 'boletos' }],
    blocos: [{ bloco: 'ficha', texto: 'Name: Maria\nPhone: +55 11 90000-0000' }],
    conhecimento: ['Horário: 9h às 18h.'],
    acoes: {
      etiquetar: [{ id: 't1', nome: 'VIP' }],
      preencher_campo: [{ id: 'c1', nome: 'E-mail', formato: { tipo: 'email' } }],
      ...HORARIOS,
    },
    agenda: { lida: true, temEmail: false },
    ...over,
  }
}

describe('o pedido em PARTES (cache do provedor)', () => {
  it('juntas, as partes são o pedido inteiro — o que o Playground mostra e as travas leem', () => {
    const a = args()
    expect(juntarPartes(partesDoPedidoDoAgente(a))).toBe(montarPedidoDoAgente(a))
    const r = { ...a, passagens: undefined, acoes: undefined, agenda: undefined, retomada: { tentativa: 1, de: 3, semResposta: '2 hours' } }
    expect(juntarPartes(partesDoPedidoDaRetomada(r))).toBe(montarPedidoDaRetomada(r))
  })

  it('três partes: a fixa do agente, a fixa do turno (passagens e ações) e a VARIÁVEL no fim', () => {
    const partes = partesDoPedidoDoAgente(args())
    expect(partes.map((p) => p.cache)).toEqual([true, true, false])
    const [doAgente, doTurno, variavel] = partes.map((p) => p.texto)
    // As regras do sistema continuam no TOPO, antes das instruções.
    expect(doAgente.indexOf(CANARIO_DAS_REGRAS)).toBeGreaterThan(-1)
    expect(doAgente.indexOf(CANARIO_DAS_REGRAS)).toBeLessThan(doAgente.indexOf('Você faz a triagem.'))
    expect(doAgente).toContain('1. Nunca prometa resultado.')
    expect(doTurno).toContain('1. Cobrança — boletos')
    expect(doTurno).toContain('[[ETIQUETAR:n]]')
    expect(doTurno).toContain('Actions you can take')
    // Tudo o que muda de turno em turno está na última.
    expect(variavel).toContain('Current date and time')
    expect(variavel).toContain('What you know about this customer')
    expect(variavel).toContain('[1] Horário: 9h às 18h.')
    expect(variavel).toContain('1. Tue 10/11 15:15')
    expect(variavel).toContain('Customer e-mail on file: no.')
    // Cada parte depois da primeira começa com a linha em branco que as separa.
    expect(doTurno.startsWith('\n\n')).toBe(true)
    expect(variavel.startsWith('\n\n')).toBe(true)
  })

  it('⚠️⚠️ as partes FIXAS não mudam com a hora, o cliente, a base nem a agenda (senão o cache erra em toda chamada)', () => {
    const fixas = (a: ArgsDoPedido) => partesDoPedidoDoAgente(a).filter((p) => p.cache).map((p) => p.texto)
    const base = fixas(args())
    expect(base.length).toBe(2)
    expect(fixas(args({ agora: new Date('2026-11-12T09:41:00Z') }))).toEqual(base)
    expect(fixas(args({ blocos: [{ bloco: 'ficha', texto: 'Name: João' }] }))).toEqual(base)
    expect(fixas(args({ blocos: [] }))).toEqual(base)
    expect(fixas(args({ conhecimento: ['Outro trecho.'] }))).toEqual(base)
    expect(fixas(args({ conhecimento: [] }))).toEqual(base)
    expect(fixas(args({ agenda: { lida: false, temEmail: true } }))).toEqual(base)
    expect(fixas(args({ agenda: { lida: true, temEmail: true, reuniaoMarcada: { inicio: '2026-11-20T17:00:00Z', remarcar: null } } }))).toEqual(base)
    // Outros horários livres (a lista é relida a cada resposta).
    expect(
      fixas(args({ acoes: { ...args().acoes, marcar_reuniao: [{ id: 'x', nome: 'x', textoNoPedido: 'Fri 13/11 09:00' }] } })),
    ).toEqual(base)
  })

  it('a ordem nova: instruções e regras, ações, e SÓ DEPOIS a data, os blocos, a base e a agenda', () => {
    const p = montarPedidoDoAgente(args())
    const ordem = [
      CANARIO_DAS_REGRAS,
      'Você faz a triagem.',
      'Rules you must always follow',
      'Other AI agents of the business',
      'Actions you can take',
      'Current date and time',
      'What you know about this customer',
      'Reference material',
      '[[REUNIAO:n]]',
      'Booking rules:',
    ].map((t) => p.indexOf(t))
    expect(ordem.every((i) => i > -1)).toBe(true)
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem)
    // Os trechos que a trava do pedido vazado procura continuam no pedido.
    const minusculo = p.replace(/\s+/g, ' ').toLowerCase()
    for (const t of TRECHOS_DO_PEDIDO.filter((t) => t !== 'brings the conversation back to what is pending')) {
      expect(minusculo).toContain(t)
    }
  })

  it('só os horários da reunião, sem outra ação: o protocolo vai junto deles, na parte VARIÁVEL', () => {
    const partes = partesDoPedidoDoAgente(args({ passagens: [], acoes: { ...HORARIOS } }))
    expect(partes.map((p) => p.cache)).toEqual([true, false])
    const variavel = partes[1].texto
    expect(variavel).toContain('Actions you can take')
    expect(variavel.indexOf('Actions you can take')).toBeLessThan(variavel.indexOf('[[REUNIAO:n]]'))
    expect(partes[0].texto).not.toContain('Actions you can take')
  })

  it('com ações fixas, o protocolo fica na parte fixa e aparece UMA vez, antes dos horários', () => {
    const p = montarPedidoDoAgente(args())
    expect(p.split('Actions you can take').length).toBe(2)
    expect(p.indexOf('Actions you can take')).toBeLessThan(p.indexOf('[[REUNIAO:n]]'))
  })

  it('sem passagem nem ação fixa, a parte fixa do turno some (duas partes)', () => {
    const partes = partesDoPedidoDoAgente(args({ passagens: [], acoes: {}, agenda: null }))
    expect(partes.map((p) => p.cache)).toEqual([true, false])
  })

  it('⚠️ a RETOMADA divide a parte fixa do agente com o turno (o mesmo cache); a seção dela é variável', () => {
    const turno = partesDoPedidoDoAgente(args())
    const retomada = partesDoPedidoDaRetomada({
      ...args({ passagens: undefined, acoes: undefined, agenda: undefined }),
      agora: new Date('2026-11-09T19:30:00Z'),
      retomada: { tentativa: 2, de: 3, semResposta: '5 hours' },
    })
    expect(retomada[0]).toEqual(turno[0])
    expect(retomada.slice(1).every((p) => !p.cache)).toBe(true)
    const texto = juntarPartes(retomada)
    expect(texto).not.toContain('Actions you can take')
    expect(texto).not.toContain('[[PASSAR:n]]')
    expect(texto.trimEnd().endsWith('write only the text for the customer.')).toBe(true)
  })
})
