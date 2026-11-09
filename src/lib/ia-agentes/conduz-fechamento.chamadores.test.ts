// "Conduz o fechamento" (1128): quem monta o pedido passa a opção DO AGENTE.
//
// O argumento obrigatório de `montarPedidoDoAgente`/`montarPedidoDaRetomada`
// só garante que ALGUM booleano é passado: trocar `agente.conduzFechamento` por
// `false` compilava e passava nos testes (revisão fria de 09/11/2026), e o
// agente ligado voltaria às regras de sempre em silêncio. Este pino lê o fonte
// dos dois chamadores — o turno (resposta e retomada) e o Playground — e exige
// a opção lida do agente em cada montagem, nunca um literal.

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

describe('conduzFechamento: os chamadores passam a opção do agente', () => {
  for (const caminho of CHAMADORES) {
    it(`${caminho}: cada montagem do pedido leva agente.conduzFechamento`, () => {
      const texto = fonte(caminho)
      // Desde 09/11/2026 (o cache do provedor) os chamadores montam o pedido em
      // PEDAÇOS (`partesDoPedido*`); `montarPedido*` é o mesmo texto, junto.
      const montagens = texto.match(/(?:montarPedido|partesDoPedido)(?:DoAgente|DaRetomada)\(\{/g) ?? []
      expect(montagens.length, 'resposta e retomada').toBe(2)
      const passados = texto.match(/conduzFechamento:\s*agente\.conduzFechamento\b/g) ?? []
      expect(passados.length).toBe(montagens.length)
      expect(texto).not.toMatch(/conduzFechamento:\s*(?:true|false)\b/)
    })
  }
})
