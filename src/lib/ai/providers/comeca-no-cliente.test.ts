import { describe, expect, it } from 'vitest'

import type { ChatMessage } from '../types'
import {
  NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO,
  NOTA_SEM_MENSAGEM_DO_CLIENTE,
  comecarNoCliente,
} from './comeca-no-cliente'
import { toGeminiContents } from './gemini'

const escritorio = (content: string): ChatMessage => ({ role: 'assistant', content })
const cliente = (content: string): ChatMessage => ({ role: 'user', content })

describe('comecarNoCliente', () => {
  it('a conversa aberta pelo escritório mantém as mensagens dele atrás da nota', () => {
    // O formulário do anúncio: o escritório escreve primeiro, e a cliente
    // responde à PERGUNTA dele. Descartada a pergunta, "foi dia 20 de outubro"
    // chegava sozinho ao modelo.
    const conversa = [
      escritorio('Boa tarde! Somos um escritório especialista em direito das gestantes.'),
      escritorio('Recebemos o seu formulário. Vi que você marcou: Pedi demissão.\n\nQual foi a data em que isso aconteceu?'),
      cliente('foi dia 20 de outubro'),
    ]
    expect(comecarNoCliente(conversa)).toEqual([
      cliente(NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO),
      escritorio(
        'Boa tarde! Somos um escritório especialista em direito das gestantes.\n\n' +
          'Recebemos o seu formulário. Vi que você marcou: Pedi demissão.\n\nQual foi a data em que isso aconteceu?',
      ),
      cliente('foi dia 20 de outubro'),
    ])
  })

  it('a conversa aberta pelo cliente só funde os turnos seguidos, sem nota', () => {
    expect(comecarNoCliente([cliente('Oi'), cliente('tudo bem?'), escritorio('Olá!'), cliente('pedi demissão')])).toEqual([
      cliente('Oi\n\ntudo bem?'),
      escritorio('Olá!'),
      cliente('pedi demissão'),
    ])
  })

  it('a retomada (nota no fim, papel de usuário) também guarda a abertura do escritório', () => {
    const conversa = [escritorio('Vi que você marcou: Fui demitida.'), cliente('sim'), escritorio('Quando você saiu?'), cliente('[System note…]')]
    const montada = comecarNoCliente(conversa)
    expect(montada.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(montada[0].content).toBe(NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO)
    expect(montada[1].content).toBe('Vi que você marcou: Fui demitida.')
  })

  it('sem nenhuma fala do cliente, fica a nota de sempre (nunca um pedido terminando no modelo)', () => {
    expect(comecarNoCliente([])).toEqual([cliente(NOTA_SEM_MENSAGEM_DO_CLIENTE)])
    expect(comecarNoCliente([escritorio('Bom dia!'), escritorio('Podemos ajudar?')])).toEqual([
      cliente(NOTA_SEM_MENSAGEM_DO_CLIENTE),
    ])
  })

  it('não altera a lista recebida', () => {
    const conversa = [escritorio('A'), escritorio('B'), cliente('C')]
    const copia = structuredClone(conversa)
    comecarNoCliente(conversa)
    expect(conversa).toEqual(copia)
  })
})

describe('toGeminiContents', () => {
  it('a abertura do escritório vira turno do modelo atrás da nota', () => {
    expect(toGeminiContents([escritorio('Vi que você marcou: Pedi demissão.'), cliente('em outubro')])).toEqual([
      { role: 'user', parts: [{ text: NOTA_DA_CONVERSA_ABERTA_PELO_ESCRITORIO }] },
      { role: 'model', parts: [{ text: 'Vi que você marcou: Pedi demissão.' }] },
      { role: 'user', parts: [{ text: 'em outubro' }] },
    ])
  })

  it('só o escritório falou: nunca termina num turno do modelo (o Gemini recusaria)', () => {
    expect(toGeminiContents([escritorio('Bom dia!')])).toEqual([
      { role: 'user', parts: [{ text: NOTA_SEM_MENSAGEM_DO_CLIENTE }] },
    ])
  })
})
