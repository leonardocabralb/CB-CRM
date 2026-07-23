#!/usr/bin/env node
/**
 * i18n-find — acha onde um texto da interface vive no código.
 *
 * Com o app em pt-BR, buscar na tela ("Respostas rápidas") só encontra o
 * dicionário, não o componente. Este script faz os dois saltos de uma vez:
 * texto (em qualquer idioma) → chave de tradução → arquivos que a usam.
 *
 *   node scripts/i18n-find.mjs "Respostas rápidas"
 *   node scripts/i18n-find.mjs "quick"                          # parcial
 *   node scripts/i18n-find.mjs --key Settings.sections.quick-replies
 *
 * Sem dependências e sem shell — a busca é feita em Node.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MSG_DIR = join(ROOT, 'messages')
const SRC_DIR = join(ROOT, 'src')

const argv = process.argv.slice(2)
const porChave = argv[0] === '--key'
const termo = (porChave ? argv[1] : argv[0])?.trim()

if (!termo) {
  console.error('uso: node scripts/i18n-find.mjs "<texto da tela>"')
  console.error('     node scripts/i18n-find.mjs --key <Chave.Pontuada>')
  process.exit(1)
}

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

/** achata um dicionário em pares [caminho.pontuado, valor] */
function achatar(node, prefixo = '', saida = []) {
  for (const [k, v] of Object.entries(node)) {
    const p = prefixo ? `${prefixo}.${k}` : k
    if (v && typeof v === 'object') achatar(v, p, saida)
    else saida.push([p, String(v)])
  }
  return saida
}

/** lista recursivamente os arquivos .ts/.tsx de src/, ignorando testes */
function fontes(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome)
    const st = statSync(p)
    if (st.isDirectory()) fontes(p, saida)
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(p)
  }
  return saida
}

const arquivos = fontes(SRC_DIR).map((p) => [p, readFileSync(p, 'utf8')])

/** linhas de src/ que casam com o regex */
function buscar(regex, limite = 8) {
  const hits = []
  for (const [caminho, conteudo] of arquivos) {
    const linhas = conteudo.split('\n')
    for (let i = 0; i < linhas.length; i++) {
      if (regex.test(linhas[i])) {
        hits.push(`${relative(ROOT, caminho)}:${i + 1}  ${linhas[i].trim().slice(0, 100)}`)
        if (hits.length >= limite) return hits
      }
      regex.lastIndex = 0
    }
  }
  return hits
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- 1º salto: texto → chave ----------
const locales = readdirSync(MSG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), achatar(JSON.parse(readFileSync(join(MSG_DIR, f), 'utf8')))])

const alvo = termo.toLowerCase()
const achadas = new Map()

for (const [locale, entradas] of locales) {
  for (const [chave, valor] of entradas) {
    const bate = porChave ? chave === termo : valor.toLowerCase().includes(alvo)
    if (bate) {
      if (!achadas.has(chave)) achadas.set(chave, [])
      achadas.get(chave).push({ locale, valor })
    }
  }
}

if (achadas.size === 0) {
  console.log(`Nenhuma chave de tradução contém "${termo}".`)
  console.log(`${DIM}Pode ser texto fixo no código — há 11 componentes sem i18n.${OFF}`)
  console.log('\nBuscando o texto direto em src/:\n')
  const hits = buscar(new RegExp(escapar(termo), 'i'), 15)
  console.log(hits.length ? hits.map((h) => '  ' + h).join('\n') : '  (nada encontrado)')
  process.exit(0)
}

console.log(`${achadas.size} chave(s) de tradução para "${termo}":\n`)

// ---------- 2º salto: chave → código ----------
for (const [chave, valores] of achadas) {
  console.log(`${BOLD}${chave}${OFF}`)
  for (const { locale, valor } of valores) {
    console.log(`   ${locale.padEnd(6)} ${JSON.stringify(valor)}`)
  }

  const partes = chave.split('.')
  const ns = partes[0]
  const folha = partes[partes.length - 1]

  // t('folha') / t.rich("folha") / t(`folha`) — ou o caminho parcial
  const usos = buscar(new RegExp(`['"\`]${escapar(folha)}['"\`]`))
  if (usos.length) {
    console.log('   usada em:')
    for (const u of usos) console.log(`     ${u}`)
  } else {
    const nsUsos = buscar(new RegExp(`[Tt]ranslations\\(\\s*['"\`]${escapar(ns)}`), 5)
    console.log(nsUsos.length
      ? `   ${DIM}chave não localizada direto; namespace "${ns}" é usado em:${OFF}\n${nsUsos.map((u) => '     ' + u).join('\n')}`
      : '   (nenhum uso encontrado em src/)')
  }
  console.log()
}
