import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// O `typecheck`, o `lint` e o `vitest` da RAIZ conferem este subprojeto com as
// dependências da raiz; a imagem compila com as DELE. Versões diferentes
// deixariam o CI verde e a montagem na VPS vermelha (ou os tipos conferidos
// contra uma versão e o código rodando com outra). O Dependabot só olha a
// raiz: subiu lá, reprova aqui até subir nos dois.
const raiz = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const maquina = JSON.parse(readFileSync(join(process.cwd(), 'maquina-de-ligacoes', 'package.json'), 'utf8'))

const daRaiz = (nome: string) => raiz.dependencies?.[nome] ?? raiz.devDependencies?.[nome]
const daMaquina = (nome: string) => maquina.dependencies?.[nome] ?? maquina.devDependencies?.[nome]

describe('as versões da máquina de ligações acompanham as da raiz', () => {
  for (const nome of ['playwright-core', 'typescript', '@types/node']) {
    it(nome, () => {
      expect(daMaquina(nome), `${nome} no maquina-de-ligacoes/package.json`).toBeDefined()
      expect(daMaquina(nome)).toBe(daRaiz(nome))
    })
  }

  it('a mesma major de Node nos engines', () => {
    expect(maquina.engines?.node).toBe(raiz.engines?.node)
  })
})
