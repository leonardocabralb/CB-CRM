import { execSync } from 'node:child_process'
import { matchesGlob } from 'node:path'
import { describe, expect, it } from 'vitest'

import { AREAS, avaliar, ehTeste, motivoDeclarado, RAIZ } from './doc-acompanha.mjs'

// ============================================================
// O portão "a doc acompanha o contrato" (job `documentacao` do CI).
//
// Dois modos de falha que nenhum PR acusaria sozinho: um glob de contrato
// que deixou de casar arquivo (a pasta foi renomeada e o portão passou a
// olhar o vazio, verde para sempre) e um documento que mudou de lugar (toda
// mudança de contrato passaria a exigir a declaração, e ela viraria rotina).
// ============================================================

type Area = { nome: string; contrato: string[]; docs: string[] }

const versionados: string[] = execSync('git ls-files', {
  cwd: RAIZ,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
})
  .split('\n')
  .filter(Boolean)

describe('as áreas apontam para o que existe', () => {
  for (const area of AREAS as Area[]) {
    for (const glob of area.contrato) {
      it(`${area.nome}: "${glob}" casa algum arquivo versionado`, () => {
        expect(versionados.some((c) => matchesGlob(c, glob))).toBe(true)
      })
    }
    for (const doc of area.docs) {
      it(`${area.nome}: o documento ${doc} existe`, () => {
        expect(versionados).toContain(doc)
      })
    }
  }
})

describe('avaliar', () => {
  const rota = 'src/app/api/v1/deals/route.ts'

  it('sem contrato tocado, não cobra nada', () => {
    const r = avaliar({ arquivos: ['src/components/inbox/x.tsx', 'docs/README.md'], mensagens: [] })
    expect(r.tocadas).toEqual([])
    expect(r.ok).toBe(true)
  })

  it('contrato sem a doc da área reprova, e diz qual área e qual doc', () => {
    const r = avaliar({ arquivos: [rota], mensagens: ['fix(api): algo'] })
    expect(r.ok).toBe(false)
    expect(r.pendentes).toHaveLength(1)
    expect(r.pendentes[0].nome).toBe('API pública (/api/v1)')
    expect(r.pendentes[0].docs).toEqual(['docs/public-api.md'])
    expect(r.pendentes[0].casados).toEqual([rota])
  })

  it('contrato com a doc da área passa', () => {
    expect(avaliar({ arquivos: [rota, 'docs/public-api.md'], mensagens: [] }).ok).toBe(true)
  })

  it('a doc de OUTRA área não serve', () => {
    const r = avaliar({ arquivos: [rota, 'docs/mcp.md'], mensagens: [] })
    expect(r.ok).toBe(false)
  })

  it('cada área tocada é cobrada: uma com doc e outra sem ainda reprova', () => {
    const r = avaliar({
      arquivos: [rota, 'docs/public-api.md', 'mcp-server/src/index.ts'],
      mensagens: [],
    })
    expect(r.ok).toBe(false)
    expect(r.pendentes.map((p: { nome: string }) => p.nome)).toEqual(['Servidor MCP'])
  })

  it('teste não é contrato', () => {
    expect(avaliar({ arquivos: ['src/app/api/v1/deals/route.test.ts'], mensagens: [] }).tocadas).toEqual([])
    expect(ehTeste('src/lib/webhooks/x.chamadores.test.ts')).toBe(true)
    expect(ehTeste('src/lib/webhooks/deliver.ts')).toBe(false)
  })

  it('a declaração num commit do PR libera, e o motivo aparece', () => {
    const r = avaliar({
      arquivos: [rota],
      mensagens: ['refactor(api): extrai helper\n\nDoc-inalterada: refatoração interna, a resposta é a mesma\n'],
    })
    expect(r.ok).toBe(true)
    expect(r.declaracao).toBe('refatoração interna, a resposta é a mesma')
  })

  it('declaração sem motivo de verdade não libera', () => {
    expect(motivoDeclarado(['Doc-inalterada: ok'])).toBeNull()
    expect(motivoDeclarado(['Doc-inalterada:'])).toBeNull()
    expect(motivoDeclarado(['doc-inalterada: refatoração interna'])).toBeNull()
    expect(motivoDeclarado(['Veja Doc-inalterada: refatoração interna'])).toBeNull()
  })

  it('a doc acompanha também a mudança de automação que ela descreve', () => {
    const r = avaliar({
      arquivos: ['src/lib/ia-agentes/executar-acoes.ts', 'docs/webhooks.md'],
      mensagens: [],
    })
    expect(r.tocadas.map((t: { nome: string }) => t.nome)).toEqual(['Automações, robôs e agentes de IA'])
    expect(r.ok).toBe(true)
  })
})
