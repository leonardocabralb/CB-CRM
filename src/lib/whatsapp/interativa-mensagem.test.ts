import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createTranslator } from 'next-intl'

import { validateInteractivePayload } from './interactive'
import {
  CODIGOS_DA_INTERATIVA,
  mensagemDaInterativa,
  type CodigoDaInterativa,
  type TradutorDaValidacao,
} from './interativa-mensagem'

const RAIZ = join(__dirname, '..', '..', '..')
const dicionario = (arq: string) =>
  JSON.parse(readFileSync(join(RAIZ, 'messages', arq), 'utf8')) as Record<string, unknown>

const PARAMS = { max: 20, id: 'dup', texto: 'Um rótulo comprido' }

describe('mensagemDaInterativa', () => {
  for (const [arq, locale] of [
    ['en.json', 'en'],
    ['pt-BR.json', 'pt-BR'],
  ] as const) {
    it(`${arq}: todo código tem frase, e a frase usa só os valores que a função passa`, () => {
      const messages = dicionario(arq)
      const t = createTranslator({ locale, messages, namespace: 'Interactive.validacao' }) as unknown as TradutorDaValidacao
      const chaves: string[] = []
      for (const codigo of CODIGOS_DA_INTERATIVA) {
        const texto = mensagemDaInterativa({ codigo, params: PARAMS }, (chave, valores) => {
          chaves.push(chave)
          return t(chave, valores)
        })
        // Chave ausente volta como o caminho; valor faltando deixa "{x}".
        expect(texto, codigo).not.toMatch(/Interactive\.validacao|\{/)
        expect(texto.length, codigo).toBeGreaterThan(0)
      }
      // Uma chave por código, sem repetir (duas frases trocadas passariam).
      expect(new Set(chaves).size).toBe(CODIGOS_DA_INTERATIVA.length)
    })
  }

  it('a frase leva os valores da falha', () => {
    const tr = createTranslator({
      locale: 'pt-BR',
      messages: dicionario('pt-BR.json'),
      namespace: 'Interactive.validacao',
    }) as unknown as TradutorDaValidacao
    const falha = validateInteractivePayload({
      kind: 'buttons',
      body: 'Oi',
      buttons: [
        { id: 'dup', title: 'A' },
        { id: 'dup', title: 'B' },
      ],
    })
    expect(falha.ok).toBe(false)
    if (falha.ok) return
    expect(mensagemDaInterativa(falha, tr)).toBe('ID de resposta repetido nos botões: "dup".')

    const longo = validateInteractivePayload({ kind: 'list', body: 'Oi', button_label: 'x'.repeat(21), sections: [] })
    if (longo.ok) throw new Error('deveria falhar')
    expect(mensagemDaInterativa(longo, tr)).toBe(
      'O rótulo do botão da lista passa do limite de 20 caracteres.',
    )
  })

  it('todo código da lista é produzido por `interactive.ts`, e todo `fail(…)` de lá leva um código da lista', () => {
    const fonte = readFileSync(join(__dirname, 'interactive.ts'), 'utf8')
    const usados = [...fonte.matchAll(/'([a-zA-Z]+)'(?=,?\s*(?:\{|\)))/g)]
      .map((m) => m[1])
      .filter((c) => (CODIGOS_DA_INTERATIVA as readonly string[]).includes(c))
    expect(new Set(usados)).toEqual(new Set<CodigoDaInterativa>(CODIGOS_DA_INTERATIVA))
    // Chamadas de `fail(` (fora a definição) = códigos distintos + 0 sobras.
    const chamadas = (fonte.match(/return fail\(/g) ?? []).length
    expect(chamadas).toBe(CODIGOS_DA_INTERATIVA.length)
  })
})
