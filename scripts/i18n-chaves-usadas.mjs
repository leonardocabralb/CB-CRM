#!/usr/bin/env node
/**
 * i18n-chaves-usadas — toda chave que o código PEDE existe no dicionário?
 *
 * Irmão do `i18n-parity.mjs`, e resolve o que ele NÃO alcança. A paridade
 * compara `en.json` com `pt-BR.json`: ela pega a chave que existe num e falta
 * no outro. Ela é CEGA para a chave que não existe em dicionário NENHUM —
 * porque aí os dois arquivos concordam, e concordam em não ter.
 *
 * Não é hipótese. Em 31/08/2026 o console de produção despejava
 * `MISSING_MESSAGE: Inbox.sidebar.tabTracking (pt-BR)` às dezenas, com
 * `noTrackingFields` e `seedTrackingFields` junto. A paridade estava VERDE:
 * 2673/2673. As três chaves faltavam nos dois dicionários.
 *
 * O que o usuário vê quando isto passa: o caminho da chave, cru, no lugar do
 * texto — `Inbox.sidebar.tabTracking` escrito dentro da aba. O fallback do
 * next-intl é por ARQUIVO, não por chave, então não há rede de segurança.
 *
 *   node scripts/i18n-chaves-usadas.mjs
 *
 * Sai com código 1 se achar chave pedida e ausente — serve de portão no CI.
 *
 * ⚠️ ALCANCE, declarado de propósito. Isto é análise estática de texto: só
 * enxerga `t('literal')`. Chave montada em variável, template ou concatenação
 * — o caso do `descreverPasso`, que devolve CHAVE e valores — é INALCANÇÁVEL
 * daqui, e o script conta e IMPRIME quantas ignorou. Um número silencioso
 * viraria "cobrimos tudo" quando não cobrimos. Essas têm proteção própria:
 * teste que lê o dicionário e cobra uma chave por tipo de passo (CLAUDE.md).
 *
 * ⚠️ A chave é cobrada contra TODOS os namespaces declarados no arquivo, não
 * contra o do binding que aparenta ser o dono. Não é frouxidão: o tradutor
 * VIAJA COMO PROP. `message-composer.tsx` declara `t` (Inbox.composer) e
 * `tAgendadas` (Inbox.scheduled), e passa `t={tAgendadas}` para o
 * `<SeletorDeHorario>` — dentro dele o parâmetro `t` SOMBREIA o do arquivo, e
 * amarrar a chave ao binding acusava sete chaves boas de faltantes. Escopo de
 * verdade exigiria um parser de TypeScript para um ganho que este script não
 * persegue: ele caça a chave que não existe em lugar NENHUM, que foi o
 * defeito real de 31/08. Preço aceito: chave válida sob um namespace irmão do
 * mesmo arquivo passa batida.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
// O locale que o app serve (NEXT_PUBLIC_APP_LOCALE). É o dicionário que
// decide o que o usuário lê, então é contra ele que a existência é cobrada.
const ATIVO = 'pt-BR'

function achatar(node, prefixo = '', saida = new Set()) {
  for (const [k, v] of Object.entries(node)) {
    const p = prefixo ? `${prefixo}.${k}` : k
    if (v && typeof v === 'object') achatar(v, p, saida)
    else saida.add(p)
  }
  return saida
}

const dicionario = achatar(
  JSON.parse(readFileSync(join(ROOT, 'messages', `${ATIVO}.json`), 'utf8')),
)

function arquivos(dir, saida = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome)
    if (statSync(caminho).isDirectory()) arquivos(caminho, saida)
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(caminho)
  }
  return saida
}

// `const t = useTranslations('NS')` / `const tX = await getTranslations("NS")`
// Sem argumento, o namespace é a raiz e a chave vem absoluta.
const RE_BINDING =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g

const faltando = []
let dinamicas = 0
let conferidas = 0

for (const caminho of arquivos(SRC)) {
  const fonte = readFileSync(caminho, 'utf8')

  const bindings = new Map()
  for (const m of fonte.matchAll(RE_BINDING)) bindings.set(m[1], m[3] ?? '')
  if (bindings.size === 0) continue
  // Ver a nota de ALCANCE: a cobrança é contra o conjunto do arquivo, porque
  // o tradutor viaja como prop e o parâmetro sombreia o binding do módulo.
  const escopos = [...new Set(bindings.values())]

  for (const binding of bindings.keys()) {
    const nome = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // `(?<![\w.$])` impede casar `obj.t(` e sufixo de outro identificador.
    const re = new RegExp(`(?<![\\w.$])${nome}(?:\\.rich)?\\(\\s*`, 'g')
    for (const m of fonte.matchAll(re)) {
      const resto = fonte.slice(m.index + m[0].length)
      const lit = resto.match(/^(['"`])((?:[^'"`\\]|\\.)*)\1/)
      // Fora do alcance: template com interpolação, concatenação, variável.
      if (!lit || (lit[1] === '`' && lit[2].includes('${'))) {
        dinamicas++
        continue
      }
      if (/^\s*\+/.test(resto.slice(lit[0].length))) {
        dinamicas++
        continue
      }
      conferidas++
      const achou = escopos.some((ns) =>
        dicionario.has(ns ? `${ns}.${lit[2]}` : lit[2]),
      )
      if (!achou) {
        // Imprime a chave CRUA e os namespaces tentados, nunca um caminho
        // montado: com mais de um namespace no arquivo, "escolher" um
        // mandaria quem for consertar para o lugar errado com ar de certeza.
        faltando.push({
          literal: lit[2],
          escopos,
          arquivo: relative(ROOT, caminho),
        })
      }
    }
  }
}

const unicas = [
  ...new Map(faltando.map((f) => [`${f.arquivo}::${f.literal}`, f])).values(),
]

console.log(`~ chaves pedidas pelo código, conferidas contra ${ATIVO}.json`)
console.log(`    literais conferidas: ${conferidas}`)
console.log(`    dinâmicas ignoradas: ${dinamicas}  (fora do alcance — ver cabeçalho)`)

if (unicas.length === 0) {
  console.log('\nOK: toda chave literal pedida pelo código existe no dicionário.')
  process.exit(0)
}

console.log(`\nFALHA: ${unicas.length} chave(s) pedida(s) e AUSENTE(S) em ${ATIVO}.json.`)
console.log('O usuário veria o caminho da chave, cru, no lugar do texto.\n')
for (const { literal, escopos, arquivo } of unicas.sort((a, b) =>
  a.arquivo.localeCompare(b.arquivo) || a.literal.localeCompare(b.literal),
)) {
  console.log(`      - "${literal}"  em ${arquivo}`)
  console.log(`        procurada sob: ${escopos.map((n) => n || '(raiz)').join(', ')}`)
}
process.exit(1)
