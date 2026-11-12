// As frases autorizadas (1131): quem monta o pedido passa a lista DO AGENTE.
//
// O argumento obrigatório de `montarPedidoDoAgente`/`montarPedidoDaRetomada`
// (e das versões em pedaços) só garante que ALGUMA lista é passada: trocar
// `agente.frasesAutorizadas` por `[]` compilaria e passaria nos testes, e o
// agente perderia as frases em silêncio — ou, ao contrário, ganharia as de um
// literal esquecido. A lição de `conduz-fechamento.chamadores.test.ts`: este
// pino lê o fonte dos dois chamadores — o turno (resposta e retomada) e o
// Playground (onde o `agente` já é o RASCUNHO aplicado) — e exige a lista lida
// do agente em cada montagem, nunca um literal.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const RAIZ = join(__dirname, '..', '..', '..')
const CHAMADORES = [
  'src/lib/ia-agentes/turno.ts',
  'src/app/api/cb/ia/agentes/[id]/playground/route.ts',
] as const

function fonte(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), 'utf8')
}

describe('frasesAutorizadas: os chamadores passam a lista do agente', () => {
  for (const caminho of CHAMADORES) {
    it(`${caminho}: cada montagem do pedido leva agente.frasesAutorizadas`, () => {
      const texto = fonte(caminho)
      const montagens = texto.match(/(?:montarPedido|partesDoPedido)(?:DoAgente|DaRetomada)\(\{/g) ?? []
      expect(montagens.length, 'resposta e retomada').toBe(2)
      const passadas = texto.match(/frasesAutorizadas:\s*agente\.frasesAutorizadas\b/g) ?? []
      expect(passadas.length).toBe(montagens.length)
      expect(texto).not.toMatch(/frasesAutorizadas:\s*\[/)
    })
  }
})
