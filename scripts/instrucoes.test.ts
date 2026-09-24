// ============================================================
// As instruções do assistente cabem no contexto?
//
// Existe porque o CLAUDE.md chegou a 626 KB (8.345 linhas) em 24/09/2026,
// crescendo ~20 KB por dia. Ele é carregado INTEIRO em toda sessão e de
// novo depois de cada compactação — e um subagente estourou 211 mil
// tokens antes de fazer qualquer coisa. A reestruturação deixou na raiz só
// o que vale em toda sessão e mandou cada regra de área para
// `.claude/rules/<área>.md`, que o Claude Code só carrega quando um
// arquivo que casa os globs do `paths:` é lido.
//
// O que este portão cobra, e por quê:
// - a raiz não passa de 40 KB e cada regra de área de 25 KB: sem teto, a
//   nota nova vai "só um parágrafo" para a raiz e o arquivo volta ao
//   tamanho antigo em um mês;
// - toda regra de área tem `paths:` — sem ele o arquivo carrega SEMPRE e
//   não economiza nada;
// - todo glob casa pelo menos um arquivo versionado — glob morto é regra
//   que nunca carrega, e ninguém percebe;
// - o índice da raiz lista toda regra de área, e não aponta para arquivo
//   que não existe — é por ele que se chega a uma regra lendo por
//   grep/cat, que não disparam o carregamento automático.
// ============================================================

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, matchesGlob, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
// O MESMO leitor do `paths:` que o script de consulta usa: dois leitores
// divergiriam sobre qual regra vale para qual arquivo.
import { arquivosDeRegra, globsDoFrontmatter, regrasPara } from './regras-do-diff.mjs'

const RAIZ = process.cwd()
const RAIZ_MAX = 40 * 1024
const REGRA_MAX = 25 * 1024
const regras = arquivosDeRegra()
const raiz = readFileSync(join(RAIZ, 'CLAUDE.md'), 'utf8')
const versionados = execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n')
  .filter(Boolean)

describe('instruções do assistente', () => {
  it('a raiz (CLAUDE.md) cabe no teto de 40 KB e começa pelo @AGENTS.md', () => {
    expect(Buffer.byteLength(raiz)).toBeLessThanOrEqual(RAIZ_MAX)
    expect(raiz.startsWith('@AGENTS.md')).toBe(true)
  })

  it('existem regras de área, e o .gitignore as deixa versionar', () => {
    expect(regras.length).toBeGreaterThan(0)
    // `.claude/*` ignora a config local; sem a exceção, regra nova some do
    // `git status` e nunca chega ao repositório.
    expect(readFileSync(join(RAIZ, '.gitignore'), 'utf8')).toMatch(/^!\.claude\/rules\/$/m)
    expect(versionados.some((f) => f.startsWith('.claude/rules/'))).toBe(true)
  })

  for (const arquivo of regras) {
    const nome = relative(RAIZ, arquivo)
    const texto = readFileSync(arquivo, 'utf8')

    describe(nome, () => {
      it('cabe no teto de 25 KB', () => {
        expect(Buffer.byteLength(texto)).toBeLessThanOrEqual(REGRA_MAX)
      })

      it('tem `paths:` — sem ele o arquivo carregaria em toda sessão', () => {
        const globs = globsDoFrontmatter(texto)
        expect(globs, 'frontmatter com paths: ausente ou malformado').not.toBeNull()
        expect(globs!.length).toBeGreaterThan(0)
      })

      it('todo glob casa pelo menos um arquivo versionado', () => {
        const mortos = (globsDoFrontmatter(texto) ?? []).filter(
          (glob) => !versionados.some((f) => matchesGlob(f, glob)),
        )
        expect(mortos, 'glob que não casa nenhum arquivo: a regra nunca carregaria').toEqual([])
      })

      it('está listado no índice da raiz', () => {
        expect(raiz).toContain(nome)
      })

      it('o script de consulta a aponta para um arquivo que ela cobre', () => {
        const globs = globsDoFrontmatter(texto) ?? []
        const coberto = versionados.find((f) => globs.some((g) => matchesGlob(f, g)))
        expect(coberto).toBeDefined()
        expect(regrasPara([coberto!]).map((r) => r.regra)).toContain(nome)
      })
    })
  }

  it('a consulta desliga a detecção de renomeação (arquivo movido entre áreas leva as regras das duas)', () => {
    // Codex, PR #286: com a detecção, `--name-only` lista só o destino.
    const script = readFileSync(join(RAIZ, 'scripts', 'regras-do-diff.mjs'), 'utf8')
    expect(script.match(/git\('diff', '--name-only', '--no-renames'/g) ?? []).toHaveLength(2)
  })

  it('o índice da raiz não aponta para regra que não existe', () => {
    const citadas = [...new Set(raiz.match(/\.claude\/rules\/[\w./-]+\.md/g) ?? [])]
    const existentes = new Set(regras.map((r) => relative(RAIZ, r)))
    expect(citadas.filter((c) => !existentes.has(c))).toEqual([])
  })
})
