import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// O detalhe do agente: as abas com rascunho ficam montadas, a aba Uso remonta
// a cada visita, e o Playground testa o RASCUNHO da tela (DC4, 26/10/2026).
// ⚠️ A conversa do Playground NÃO zera mais ao salvar (antes zerava: Codex,
// #295): cada resposta leva o selo da versão que a gerou.
const fonte = readFileSync(join(__dirname, 'detalhe-do-agente.tsx'), 'utf8')
const playground = readFileSync(join(__dirname, 'playground-do-agente.tsx'), 'utf8')

/** O corpo de cada `useEffect(() => { … }, …)` do fonte. */
function corposDosEfeitos(f: string): string[] {
  const saida: string[] = []
  for (const m of f.matchAll(/useEffect\(/g)) {
    let profundidade = 0
    let i = m.index + 'useEffect'.length
    const inicio = i
    for (; i < f.length; i++) {
      if (f[i] === '(') profundidade++
      else if (f[i] === ')' && --profundidade === 0) break
    }
    saida.push(f.slice(inicio, i + 1))
  }
  return saida
}

describe('detalhe-do-agente — abas', () => {
  it('⚠️ salvar NÃO zera a conversa do Playground: a key é só o id do agente (DC4)', () => {
    const doPlayground = fonte.slice(fonte.indexOf('<PlaygroundDoAgente'))
    expect(doPlayground.slice(0, 80)).toContain('key={e.agente.id}')
    expect(fonte).not.toMatch(/salvamentos/i)
  })

  it('⚠️ e o Playground não zera a conversa sozinho quando o agente muda (nenhum efeito mexe nela)', () => {
    const efeitos = corposDosEfeitos(playground)
    expect(efeitos.length).toBeGreaterThan(0)
    for (const e of efeitos) expect(e).not.toContain('setTurnos')
    // Cada resposta leva o selo da versão que a gerou.
    expect(playground).toContain("t('playground.versaoSalvo'")
    expect(playground).toContain("t('playground.versaoRascunho')")
    expect(playground).toContain('toLocaleTimeString(undefined')
  })

  it('salvar qualquer aba atualiza o agente na tela (a versão salva nova)', () => {
    for (const aba of ['<ConfiguracaoDoAgente', '<AcessoDoAgente', '<FerramentasDoAgente', '<RetomadaDoAgente']) {
      expect(fonte.slice(fonte.indexOf(aba)).slice(0, 260), aba).toContain('aoSalvar={aoSalvarAgente}')
    }
  })

  it('⚠️ Configuração, Acesso, Ferramentas e Retomada avisam o RASCUNHO; a Base não (o teste usa a SALVA)', () => {
    const pares = [
      ['<ConfiguracaoDoAgente', 'setRascunhoDaConfiguracao'],
      ['<AcessoDoAgente', 'setRascunhoDoAcesso'],
      ['<FerramentasDoAgente', 'setRascunhoDasFerramentas'],
      ['<RetomadaDoAgente', 'setRascunhoDaRetomada'],
    ]
    for (const [aba, setter] of pares) {
      expect(fonte.slice(fonte.indexOf(aba)).slice(0, 300), aba).toContain(`aoMudarRascunho={${setter}}`)
    }
    const base = fonte.slice(fonte.indexOf('<BaseDoAgente'))
    expect(base.slice(0, base.indexOf('/>'))).not.toContain('aoMudarRascunho')
  })

  it('o Playground recebe o rascunho juntado SÓ com o carimbo da versão atual (efeito passivo)', () => {
    expect(fonte).toContain('juntarRascunhos(e.agente.updatedAt, [')
    const doPlayground = fonte.slice(fonte.indexOf('<PlaygroundDoAgente'))
    expect(doPlayground.slice(0, 300)).toContain('rascunho={rascunho}')
    expect(doPlayground.slice(0, 300)).toContain('baseNaoSalva={baseNaoSalva}')
  })

  it('Acesso, Base (F3), Ferramentas (F4) e Retomada (1056) têm rascunho: montadas depois da 1ª visita, escondidas (não desmontadas)', () => {
    for (const aba of ['acesso', 'base', 'ferramentas', 'retomada']) {
      expect(fonte).toContain(`{visitadas.has('${aba}') ? (`)
      expect(fonte).toContain(`<div hidden={aba !== '${aba}'}>`)
    }
  })

  it('o Playground diz QUAIS abas têm alteração não salva', () => {
    for (const flag of ['configuracaoNaoSalva', 'acessoNaoSalvo', 'baseNaoSalva', 'ferramentasNaoSalvas', 'retomadaNaoSalva']) {
      expect(fonte).toContain(flag)
    }
    expect(fonte).toContain('naoSalvoEm={naoSalvoEm}')
  })

  it('a Retomada fica entre as Ferramentas e o Playground (1056)', () => {
    const ferramentas = fonte.indexOf("{ id: 'ferramentas'")
    const retomada = fonte.indexOf("{ id: 'retomada'")
    const playground = fonte.indexOf("{ id: 'playground'")
    expect(retomada).toBeGreaterThan(ferramentas)
    expect(playground).toBeGreaterThan(retomada)
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
