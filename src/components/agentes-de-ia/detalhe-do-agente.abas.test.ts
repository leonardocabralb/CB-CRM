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

  it('salvar o Acesso ou a Base (F3) também zera a conversa do Playground', () => {
    const acesso = fonte.slice(fonte.indexOf('<AcessoDoAgente'))
    expect(acesso.slice(0, 200)).toContain('aoSalvar={aoSalvarAgente}')
    const base = fonte.slice(fonte.indexOf('<BaseDoAgente'))
    expect(base.slice(0, 200)).toContain('aoSalvar={() => setSalvamentos((n) => n + 1)}')
  })

  it('Acesso e Base (F3) têm rascunho: montadas depois da 1ª visita, escondidas (não desmontadas)', () => {
    for (const aba of ['acesso', 'base']) {
      expect(fonte).toContain(`{visitadas.has('${aba}') ? (`)
      expect(fonte).toContain(`<div hidden={aba !== '${aba}'}>`)
    }
  })

  it('o Playground diz QUAIS abas têm alteração não salva', () => {
    for (const flag of ['configuracaoNaoSalva', 'acessoNaoSalvo', 'baseNaoSalva']) expect(fonte).toContain(flag)
    expect(fonte).toContain('naoSalvoEm={naoSalvoEm}')
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
