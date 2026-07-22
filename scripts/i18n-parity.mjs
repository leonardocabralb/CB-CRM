#!/usr/bin/env node
/**
 * i18n-parity — confere se os dicionários estão consistentes.
 *
 * Rodar SEMPRE depois de `git merge upstream/main`: quando o upstream adiciona
 * uma chave em en.json, ela precisa existir no pt-BR.json também. O fallback do
 * next-intl é por ARQUIVO, não por chave — chave faltando não cai para o
 * inglês, vira MISSING_MESSAGE e o usuário vê a chave crua na tela.
 *
 *   node scripts/i18n-parity.mjs          # confere pt-BR contra en (padrão)
 *   node scripts/i18n-parity.mjs --all    # confere todos os locales
 *
 * Sai com código 1 se achar problema — serve em hook/CI.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@formatjs/icu-messageformat-parser'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MSG_DIR = join(ROOT, 'messages')
const BASE = 'en'
const ATIVO = 'pt-BR' // o locale que o app usa (NEXT_PUBLIC_APP_LOCALE)

const todos = process.argv.includes('--all')

function achatar(node, prefixo = '', saida = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    const p = prefixo ? `${prefixo}.${k}` : k
    if (v && typeof v === 'object') achatar(v, p, saida)
    else saida.set(p, String(v))
  }
  return saida
}

const ler = (loc) => achatar(JSON.parse(readFileSync(join(MSG_DIR, `${loc}.json`), 'utf8')))

/** nomes reais de argumento ICU, via AST (ignora texto dos ramos de plural) */
function argumentos(s) {
  const out = new Set()
  const walk = (ns) => {
    for (const n of ns) {
      if (n.value !== undefined && n.type !== 0) out.add(n.value)
      if (n.options) for (const k of Object.keys(n.options)) walk(n.options[k].value)
      if (n.children) walk(n.children)
    }
  }
  walk(parse(s))
  return out
}

const base = ler(BASE)
const locales = todos
  ? readdirSync(MSG_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).filter((l) => l !== BASE)
  : [ATIVO]

let falhou = false

for (const loc of locales) {
  const alvo = ler(loc)
  const faltando = [...base.keys()].filter((k) => !alvo.has(k))
  const sobrando = [...alvo.keys()].filter((k) => !base.has(k))

  const invalidas = []
  const argsDivergentes = []
  for (const [k, v] of alvo) {
    try {
      const a = base.get(k)
      if (a !== undefined) {
        const A = [...argumentos(a)].sort().join(',')
        const B = [...argumentos(v)].sort().join(',')
        if (A !== B) argsDivergentes.push(`${k}  en=[${A}] ${loc}=[${B}]`)
      } else {
        argumentos(v)
      }
    } catch (e) {
      invalidas.push(`${k}  ${String(e.message).split('\n')[0].slice(0, 60)}`)
    }
  }

  const ativo = loc === ATIVO
  // Só chave faltando e placeholder divergente são SEMPRE visíveis ao usuário.
  // Erro de parse ICU não é: `t()` sem values devolve a string crua e renderiza
  // certo — só `t.rich(...)` falha na tela. Tratar isso como falha faria o
  // script pedir o "conserto" que já causou a regressão de 4e8f2c6.
  const bloqueantes = faltando.length + argsDivergentes.length
  const marca = bloqueantes === 0 ? (invalidas.length ? '~' : '✓') : ativo ? '✗' : '!'

  console.log(`${marca} ${loc}${ativo ? '  (locale ativo)' : ''}`)
  console.log(`    chaves: ${alvo.size} / ${base.size} em ${BASE}`)
  if (faltando.length) {
    console.log(`    FALTANDO (${faltando.length}) — vão aparecer como chave crua na tela:`)
    for (const k of faltando.slice(0, 15)) console.log(`      - ${k}`)
    if (faltando.length > 15) console.log(`      … e mais ${faltando.length - 15}`)
  }
  if (sobrando.length) console.log(`    sobrando (${sobrando.length}, inofensivo): ${sobrando.slice(0, 5).join(', ')}`)
  if (argsDivergentes.length) {
    console.log(`    PLACEHOLDERS DIVERGENTES (${argsDivergentes.length}) — quebram a interpolação:`)
    for (const k of argsDivergentes.slice(0, 10)) console.log(`      - ${k}`)
  }
  if (invalidas.length) {
    console.log(`    aviso: ${invalidas.length} mensagem(ns) não parseiam no ICU.`)
    console.log('    NÃO é falha por si só: t() sem values devolve a string crua e')
    console.log('    renderiza correto. Só vira bug se a chave for usada com t.rich.')
    console.log('    Confira o consumo antes de mexer:  node scripts/i18n-find.mjs --key <chave>')
    for (const k of invalidas.slice(0, 10)) console.log(`      - ${k}`)
  }
  console.log()

  // só o locale ativo derruba o processo — ko.json quebrado não afeta o app
  if (ativo && bloqueantes > 0) falhou = true
}

if (falhou) {
  console.log('Falhou: o locale ativo tem problema que o usuário VERIA na tela.')
  process.exit(1)
}
console.log('OK: o locale ativo está consistente com o inglês.')
