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

  it('salvar o Acesso, a Base (F3) ou as Ferramentas (F4) também zera a conversa do Playground', () => {
    const acesso = fonte.slice(fonte.indexOf('<AcessoDoAgente'))
    expect(acesso.slice(0, 200)).toContain('aoSalvar={aoSalvarAgente}')
    const ferramentas = fonte.slice(fonte.indexOf('<FerramentasDoAgente'))
    expect(ferramentas.slice(0, 200)).toContain('aoSalvar={aoSalvarAgente}')
    const base = fonte.slice(fonte.indexOf('<BaseDoAgente'))
    expect(base.slice(0, 200)).toContain('aoSalvar={() => setSalvamentos((n) => n + 1)}')
  })

  it('Acesso, Base (F3) e Ferramentas (F4) têm rascunho: montadas depois da 1ª visita, escondidas (não desmontadas)', () => {
    for (const aba of ['acesso', 'base', 'ferramentas']) {
      expect(fonte).toContain(`{visitadas.has('${aba}') ? (`)
      expect(fonte).toContain(`<div hidden={aba !== '${aba}'}>`)
    }
  })

  it('o Playground diz QUAIS abas têm alteração não salva', () => {
    for (const flag of ['configuracaoNaoSalva', 'acessoNaoSalvo', 'baseNaoSalva', 'ferramentasNaoSalvas']) {
      expect(fonte).toContain(flag)
    }
    expect(fonte).toContain('naoSalvoEm={naoSalvoEm}')
  })

  it('Ferramentas fica entre a Base e o Playground (D28)', () => {
    const base = fonte.indexOf("{ id: 'base'")
    const ferramentas = fonte.indexOf("{ id: 'ferramentas'")
    const playground = fonte.indexOf("{ id: 'playground'")
    expect(base).toBeGreaterThan(-1)
    expect(ferramentas).toBeGreaterThan(base)
    expect(playground).toBeGreaterThan(ferramentas)
  })

  it('a aba Uso só existe enquanto está aberta (remonta e busca de novo)', () => {
    expect(fonte).toContain("{aba === 'uso' ? <UsoDeIa")
    expect(fonte).not.toContain("visitadas.has('uso')")
  })

  it('a aba Turnos também remonta a cada visita (mostra os turnos de agora)', () => {
    expect(fonte).toContain("{aba === 'turnos' ? <TurnosDoAgente")
    expect(fonte).not.toContain("visitadas.has('turnos')")
  })
})
