#!/usr/bin/env node
/**
 * regras-do-diff — quais regras de área (.claude/rules/) valem para estes
 * arquivos?
 *
 * O Claude Code só carrega uma regra de área quando a ferramenta Read abre um
 * arquivo que casa os globs do `paths:` dela. Revisar um diff pelo terminal
 * (`git diff`, `cat`, `grep`) ou planejar um arquivo que ainda não existe não
 * dispara nada — e a regra que mais importa é justamente a que ninguém abriu.
 * Este script responde a pergunta pela mesma régua do carregamento.
 *
 *   node scripts/regras-do-diff.mjs                 # o diff contra origin/main
 *   node scripts/regras-do-diff.mjs main            # contra outra base
 *   node scripts/regras-do-diff.mjs --caminho src/lib/asaas/regua.ts src/app/x.tsx
 *
 * O diff inclui o que ainda não foi commitado (alterado e não rastreado).
 * O leitor do `paths:` é o MESMO do portão `scripts/instrucoes.test.ts` —
 * dois leitores divergiriam sobre qual regra vale para qual arquivo.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, matchesGlob, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
export const PASTA_DAS_REGRAS = join(RAIZ, '.claude', 'rules')

/** Todo `.md` debaixo de `.claude/rules/`, em ordem. */
export function arquivosDeRegra(dir = PASTA_DAS_REGRAS, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivosDeRegra(caminho, saida)
    else if (nome.endsWith('.md')) saida.push(caminho)
  }
  return saida.sort()
}

/** Os globs do frontmatter `paths:` (lista YAML simples, com ou sem aspas); `null` sem frontmatter ou sem `paths:`. */
export function globsDoFrontmatter(texto) {
  if (!texto.startsWith('---\n')) return null
  const fim = texto.indexOf('\n---', 4)
  if (fim < 0) return null
  const linhas = texto.slice(4, fim).split('\n')
  const inicio = linhas.findIndex((l) => /^paths:\s*$/.test(l))
  if (inicio < 0) return null
  const globs = []
  for (const linha of linhas.slice(inicio + 1)) {
    const m = linha.match(/^\s+-\s+(.+?)\s*$/)
    if (!m) break
    globs.push(m[1].replace(/^["']|["']$/g, ''))
  }
  return globs
}

/** Para cada regra que casa algum dos caminhos (relativos à raiz): a regra e os caminhos casados. */
export function regrasPara(caminhos, raiz = RAIZ) {
  const saida = []
  for (const arquivo of arquivosDeRegra(join(raiz, '.claude', 'rules'))) {
    const globs = globsDoFrontmatter(readFileSync(arquivo, 'utf8')) ?? []
    const casados = caminhos.filter((c) => globs.some((g) => matchesGlob(c, g)))
    if (casados.length > 0) saida.push({ regra: relative(raiz, arquivo), casados })
  }
  return saida
}

function git(...args) {
  return execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\n')
    .filter(Boolean)
}

function main() {
  const args = process.argv.slice(2)
  let caminhos
  if (args[0] === '--caminho') {
    caminhos = args.slice(1)
    if (caminhos.length === 0) {
      console.error('uso: node scripts/regras-do-diff.mjs --caminho <arquivo…>')
      process.exit(2)
    }
  } else {
    const base = args[0] ?? 'origin/main'
    caminhos = [
      ...new Set([
        // --no-renames: com a detecção de renomeação, o arquivo movido entre
        // áreas sai só com o DESTINO, e as regras da origem somem (Codex, PR
        // #286). Sem ela, a origem aparece como apagada e o destino como novo.
        ...git('diff', '--name-only', '--no-renames', `${base}...HEAD`),
        ...git('diff', '--name-only', '--no-renames', 'HEAD'),
        ...git('ls-files', '--others', '--exclude-standard'),
      ]),
    ].sort()
  }

  const achadas = regrasPara(caminhos)
  const cobertos = new Set(achadas.flatMap((a) => a.casados))
  if (achadas.length === 0) console.log('Nenhuma regra de área casa estes arquivos.')
  for (const { regra, casados } of achadas) {
    const amostra = casados.slice(0, 3).join(', ')
    const resto = casados.length > 3 ? ` (+${casados.length - 3})` : ''
    console.log(`${regra}  ← ${amostra}${resto}`)
  }
  const sem = caminhos.filter((c) => !cobertos.has(c))
  if (sem.length > 0) console.log(`\nSem regra de área (vale só a raiz): ${sem.length} arquivo(s).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
