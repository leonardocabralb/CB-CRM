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
 * enxerga chave LITERAL. Cobre `t('k')`, `t.rich/.raw/.markup('k')` e a
 * invocação direta `useTranslations('NS')('k')`. Chave montada em variável,
 * template ou concatenação — o caso do `descreverPasso`, que devolve CHAVE e
 * valores — é INALCANÇÁVEL daqui, e o script conta e IMPRIME quantas ignorou.
 * Um número silencioso viraria "cobrimos tudo" quando não cobrimos. Essas têm
 * proteção própria: teste que lê o dicionário e cobra uma chave por tipo de
 * passo (CLAUDE.md).
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

// `I18N_CHECK_ROOT` existe para o TESTE DO PRÓPRIO SCRIPT (F6 do plano
// 31/08): aponta para uma árvore fixture com `src/` e `messages/` próprios.
// Sem a env, comporta como sempre — a raiz do repositório.
const ROOT =
  process.env.I18N_CHECK_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
// O locale que o app serve (NEXT_PUBLIC_APP_LOCALE). É o dicionário que
// decide o que o usuário lê, então é contra ele que a existência é cobrada.
const ATIVO = 'pt-BR'

// ⚠️ PISO DE COBERTURA (#24): "nenhuma faltante" só é boa notícia se o
// script ainda estiver ENXERGANDO as chamadas — um alias no import ou um
// refactor nos regexes zerava a cobertura em silêncio e o portão seguia
// verde afirmando uma garantia que não conferiu. O repo tinha ~2670 literais
// em 31/08/2026; o piso fica com folga abaixo (o número CRESCE com o
// produto). Se este check reprovar sem você ter removido código de i18n, o
// defeito é o ALCANCE do script — conserte o regex, não o piso. Encolhimento
// legítimo do repo: ajuste o número no mesmo PR, dizendo por quê.
const PISO_CONFERIDAS = Number(process.env.I18N_CHECK_PISO ?? 2400)

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

// Todos os SUFIXOS por ponto de toda chave do dicionário (`a.b.c` → c, b.c,
// a.b.c). Serve ao "modo folha" abaixo, onde o namespace é desconhecido:
// comparar a chave pedida só contra o ÚLTIMO segmento reprovava chave
// aninhada VÁLIDA (`t('table.name')` sob um namespace entregue por prop —
// achado #20 do plano 31/08, medido: falso vermelho travando publicação).
const sufixos = new Set()
for (const k of dicionario) {
  const partes = k.split('.')
  for (let i = 0; i < partes.length; i++) sufixos.add(partes.slice(i).join('.'))
}

// `const t = useTranslations('NS')` / `const tX = await getTranslations("NS")`
// Sem argumento, o namespace é a raiz e a chave vem absoluta.
const RE_BINDING =
  /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:(['"`])([^'"`]*)\2)?\s*\)/g

// `useTranslations('NS')('chave')` — sem passar por variável nenhuma.
// Existe uma no repo (flows/forms/fields.tsx) e o laço por binding não a vê.
const RE_DIRETO =
  /(?:useTranslations|getTranslations)\(\s*(['"`])([^'"`]*)\1\s*\)(?:\.(?:rich|raw|markup))?\(\s*(['"`])((?:[^'"`\\]|\\.)*)\3/g

// ⚠️ `.raw` e `.markup` entram junto com `.rich`: os três disparam
// MISSING_MESSAGE igual, e `t.raw` sozinho aparece 15 vezes no repo.
const METODOS = '(?:\\.(?:rich|raw|markup))?'

const faltando = []
const foraDeAlcance = []
let dinamicas = 0
let conferidas = 0
let emModoFolha = 0

/** O primeiro argumento é um literal utilizável? Devolve-o, ou null. */
function literalInicial(resto) {
  const lit = resto.match(/^(['"`])((?:[^'"`\\]|\\.)*)\1/)
  // Fora do alcance: template com interpolação, concatenação, variável.
  if (!lit || (lit[1] === '`' && lit[2].includes('${'))) return null
  if (/^\s*\+/.test(resto.slice(lit[0].length))) return null
  return lit[2]
}

for (const caminho of arquivos(SRC)) {
  const fonte = readFileSync(caminho, 'utf8')

  // ⚠️ Nome → CONJUNTO de namespaces (#19): dois componentes no mesmo
  // arquivo, cada um com `const t = useTranslations('...')` próprio, são
  // padrão comum de React — sobrescrever por nome deixava só o ÚLTIMO
  // namespace e as chaves válidas do primeiro reprovavam (medido). É isto
  // que torna verdadeira a promessa "cobra contra TODOS os namespaces".
  const bindings = new Map()
  for (const m of fonte.matchAll(RE_BINDING)) {
    if (!bindings.has(m[1])) bindings.set(m[1], new Set())
    bindings.get(m[1]).add(m[3] ?? '')
  }
  // Ver a nota de ALCANCE: a cobrança é contra o conjunto do arquivo, porque
  // o tradutor viaja como prop e o parâmetro sombreia o binding do módulo.
  const escopos = [...new Set([...bindings.values()].flatMap((s) => [...s]))]


  // Chamada direta, sem variável no meio.
  for (const m of fonte.matchAll(RE_DIRETO)) {
    if (m[3] === '`' && m[4].includes('${')) {
      dinamicas++
      continue
    }
    conferidas++
    const chave = m[2] ? `${m[2]}.${m[4]}` : m[4]
    if (!dicionario.has(chave)) {
      faltando.push({ literal: m[4], escopos: [m[2]], arquivo: relative(ROOT, caminho) })
    }
  }

  // ⚠️ MODO FOLHA — arquivo que RECEBE o tradutor como prop e não declara
  // binding nenhum (`flows/shared.tsx`, `message-media.tsx`). Sem binding não
  // há namespace, e pular o arquivo inteiro era um buraco: chave apagada dos
  // dois dicionários mantinha o CI verde (achado do Codex no PR #82). Aqui a
  // chave é cobrada como SUFIXO de alguma chave do dicionário (#20) —
  // garantia mais fraca, e é por isso que o total sai impresso. Ainda assim
  // pega a classe que motivou o script: a chave que não existe em lugar
  // nenhum. Resolver o namespace de verdade exigiria seguir o `t={...}` até
  // o chamador, em outro arquivo.
  //
  // ⚠️ SÓ o identificador `t` exato (#18): a forma antiga (`t[A-Z]?\w*`)
  // casava `twMerge(`, `toast(`, `truncate(` — e um literal no primeiro
  // argumento de qualquer um deles reprovava o CI com "chave ausente"
  // (medido: `toast('Contrato salvo')` → FALHA). `t` é a convenção da casa
  // para tradutor-por-prop, nos dois arquivos folha reais.
  if (bindings.size === 0) {
    // ⚠️ Guarda de cobertura (#24): o arquivo importa o tradutor EM VALOR,
    // não tem binding que o script enxergue nem a invocação direta — um
    // alias no import (`useTranslations as useT`) ou um envelope local
    // apagava a cobertura SEM SINAL NENHUM e o portão seguia verde.
    //
    // Roda ANTES (e independente) do modo folha, de propósito: um arquivo
    // que recebe `t` por prop E importa o hook com alias tinha só as
    // chamadas folha conferidas, e o alias passava em silêncio (achado do
    // Codex no PR #91). Import SÓ COMO TIPO (`import type { useTranslations }`
    // para `ReturnType<typeof useTranslations>`, message-media.tsx) não é
    // binding em potencial — não há o que cobrir — e fica de fora pelo
    // `(?!type\b)` e pelo `(?<!\btype\s)` (o especificador inline).
    if (
      /import\s+(?!type\b)[^;]*(?<!\btype\s)\b(?:useTranslations|getTranslations)\b[^;]*from\s+['"]next-intl/.test(
        // Sem comentários: um comentário que DESCREVA a forma proibida
        // ("import em valor…") logo acima de um `import type` real casava
        // o `[^;]*` atravessando as linhas até o import de verdade.
        fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
      ) &&
      // Cópia SEM a flag `g`: `.test` numa global avança `lastIndex` e o
      // `matchAll` de RE_DIRETO no próximo arquivo herdaria o cursor.
      !new RegExp(RE_DIRETO.source).test(fonte)
    ) {
      foraDeAlcance.push(relative(ROOT, caminho))
    }
    if (!/(?<![\w.$])t(?:\.(?:rich|raw|markup))?\(\s*['"`]/.test(fonte)) continue
    emModoFolha++
    for (const m of fonte.matchAll(
      new RegExp(`(?<![\\w.$])t${METODOS}\\(\\s*`, 'g'),
    )) {
      const chave = literalInicial(fonte.slice(m.index + m[0].length))
      if (chave === null) {
        dinamicas++
        continue
      }
      conferidas++
      if (!sufixos.has(chave)) {
        faltando.push({
          literal: chave,
          escopos: ['(namespace desconhecido — modo folha)'],
          arquivo: relative(ROOT, caminho),
        })
      }
    }
    continue
  }

  for (const binding of bindings.keys()) {
    const nome = binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // `(?<![\w.$])` impede casar `obj.t(` e sufixo de outro identificador.
    const re = new RegExp(`(?<![\\w.$])${nome}${METODOS}\\(\\s*`, 'g')
    for (const m of fonte.matchAll(re)) {
      const chave = literalInicial(fonte.slice(m.index + m[0].length))
      if (chave === null) {
        dinamicas++
        continue
      }
      conferidas++
      const achou = escopos.some((ns) => dicionario.has(ns ? `${ns}.${chave}` : chave))
      if (!achou) {
        // Imprime a chave CRUA e os namespaces tentados, nunca um caminho
        // montado: com mais de um namespace no arquivo, "escolher" um
        // mandaria quem for consertar para o lugar errado com ar de certeza.
        faltando.push({
          literal: chave,
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
console.log(
  `    arquivos em modo folha: ${emModoFolha}  (tradutor recebido como prop —` +
    ` chave cobrada por sufixo do dicionário)`,
)

// As duas guardas do #24 vêm ANTES do veredito de chaves: um "OK" calculado
// sobre cobertura quebrada é o falso verde que elas existem para matar.
if (foraDeAlcance.length > 0) {
  console.log(
    `\nFALHA: ${foraDeAlcance.length} arquivo(s) importam o tradutor do next-intl` +
      ` e o script não achou NENHUM binding neles — um alias no import` +
      ` (\`useTranslations as useT\`) ou um envelope local apaga a cobertura` +
      ` do arquivo inteiro, em silêncio.`,
  )
  for (const a of foraDeAlcance.sort()) console.log(`      - ${a}`)
  console.log(
    '    Use `const t = useTranslations(...)` direto, ou ensine a forma nova a este script.',
  )
  process.exit(1)
}
if (conferidas < PISO_CONFERIDAS) {
  console.log(
    `\nFALHA: a cobertura CAIU — ${conferidas} literais conferidas, piso ${PISO_CONFERIDAS}.` +
      `\n    O defeito é o ALCANCE do script (regex que deixou de casar as chamadas),` +
      `\n    não uma chave de tradução. Se o repo encolheu de verdade, ajuste` +
      `\n    PISO_CONFERIDAS no mesmo PR, dizendo por quê.`,
  )
  process.exit(1)
}

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
