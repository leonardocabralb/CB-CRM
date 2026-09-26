import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// O detalhe do agente (Codex, #295): a conversa do Playground zera a cada
// salvamento da configuração, e a aba Uso remonta a cada visita.
const fonte = readFileSync(join(__dirname, 'detalhe-do-agente.tsx'), 'utf8')

describe('detalhe-do-agente — abas', () => {
  it('o salvamento conta, e a contagem entra na key do Playground', () => {
    expect(fonte).toContain('setSalvamentos((n) => n + 1)')
    const playground = fonte.slice(fonte.indexOf('<PlaygroundDoAgente'))
    expect(playground.slice(0, 120)).toContain('key={`${e.agente.id}:${salvamentos}`}')
  })

  it('a aba Uso só existe enquanto está aberta (remonta e busca de novo)', () => {
    expect(fonte).toContain("{aba === 'uso' ? <UsoDeIa")
    expect(fonte).not.toContain("visitadas.has('uso')")
  })
})
