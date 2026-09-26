import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

// ============================================================
// QUEM grava a trava do lembrete (`cb_automation_reminders`, 935) —
// default-deny, no desenho dos outros `*.chamadores.test.ts`.
//
// A trava é UNIQUE (automation_id, contact_id, VALOR) em TEXTO, e o mesmo
// horário chega escrito de jeitos diferentes: medido em produção, o campo da
// reunião era gravado pela automação do Calendly ("…17:30:00.000000Z") e,
// ~1 s depois, pela API v1 ("…17:30:00.000Z"). O ciclo da varredura que lia
// entre as duas escritas travava a 1ª forma, o seguinte lia a 2ª — outra
// chave — e o cliente recebia o lembrete DUAS vezes.
//
// Por isso TODO INSERT/UPSERT na trava passa o valor por `chaveDaTrava` (o
// instante canônico), e os escritores são EXATAMENTE a varredura e o
// cancelamento pré-armado do Calendly. Um terceiro escritor reprova aqui até
// alguém decidir, por escrito, que ele também grava pelo instante.
//
// ⚠️ O default-deny é por CITAÇÃO da tabela, não pela forma da escrita
// (revisão do PR #305): uma regex de `.from(...).insert(` não enxerga o
// `.update({ valor })`, o construtor guardado numa variável nem o nome da
// tabela numa constante. Por isso TODO arquivo que cita o literal entra em
// `CITACOES` com a contagem exata — a leitura, a devolução e a poda
// inclusive —, e só então as escritas reconhecidas são conferidas.
// ============================================================

const SRC = path.join(__dirname, '..', '..')

/**
 * arquivo → quantas vezes o literal `'cb_automation_reminders'` aparece nele
 * (sem comentários). Arquivo novo, ou citação a mais, reprova.
 */
const CITACOES: Record<string, number> = {
  // A leitura das travas já gravadas, a reivindicação, a devolução e a poda.
  'lib/automations/varrer-lembretes.ts': 4,
  // O upsert do cancelamento pré-armado.
  'lib/calendly/cancelamento.ts': 1,
}

/** arquivo → quantos INSERT/UPSERT ele faz na trava. */
const ESCRITORES: Record<string, number> = {
  // A reivindicação, ANTES do disparo.
  'lib/automations/varrer-lembretes.ts': 1,
  // O desarme do cancelamento (1013), que PROMOVE a trava existente.
  'lib/calendly/cancelamento.ts': 1,
}

function* todosOsFontes(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* todosOsFontes(p)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) yield p
  }
}

/** Fonte sem comentários — eles CITAM a tabela ao explicar a decisão. */
function semComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/** O texto entre o `(` em `abre` e o `)` que o fecha, pulando strings. */
function argumentos(src: string, abre: number): string {
  let nivel = 0
  let aspas: string | null = null
  for (let i = abre; i < src.length; i += 1) {
    const c = src[i]
    if (aspas) {
      if (c === '\\') i += 1
      else if (c === aspas) aspas = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') aspas = c
    else if (c === '(') nivel += 1
    else if (c === ')') {
      nivel -= 1
      if (nivel === 0) return src.slice(abre + 1, i)
    }
  }
  return src.slice(abre + 1)
}

/** Quantas vezes o nome da tabela aparece como literal de texto. */
function citacoes(src: string): number {
  return [...src.matchAll(/['"`]cb_automation_reminders['"`]/g)].length
}

/** Os argumentos de cada `.insert(`/`.upsert(` encadeado logo depois de `.from('cb_automation_reminders')`. */
function escritasNaTrava(src: string): string[] {
  const achadas: string[] = []
  const re = /\.from\(\s*['"]cb_automation_reminders['"]\s*\)\s*\.\s*(insert|upsert)\s*\(/g
  for (const m of src.matchAll(re)) {
    achadas.push(argumentos(src, (m.index ?? 0) + m[0].length - 1))
  }
  return achadas
}

/** Os argumentos de cada `.update(` encadeado logo depois do `.from(...)` da trava. */
function atualizacoesNaTrava(src: string): string[] {
  const achadas: string[] = []
  const re = /\.from\(\s*['"]cb_automation_reminders['"]\s*\)\s*\.\s*update\s*\(/g
  for (const m of src.matchAll(re)) {
    achadas.push(argumentos(src, (m.index ?? 0) + m[0].length - 1))
  }
  return achadas
}

/** Todo `valor:` do payload passa por `chaveDaTrava(`? (e há pelo menos um) */
function gravaPeloInstante(payload: string): boolean {
  const chaves = [...payload.matchAll(/(?<![\w])['"]?valor['"]?\s*:\s*([^,\n}]*)/g)]
  return chaves.length > 0 && chaves.every((m) => /^chaveDaTrava\(/.test(m[1].trim()))
}

describe('a trava do lembrete é gravada pelo INSTANTE, nos dois escritores', () => {
  const achado: Record<string, string[]> = {}
  const citado: Record<string, number> = {}
  const atualizado: Record<string, string[]> = {}
  for (const abs of todosOsFontes(SRC)) {
    const rel = path.relative(SRC, abs).split(path.sep).join('/')
    const fonte = semComentarios(fs.readFileSync(abs, 'utf8'))
    const n = citacoes(fonte)
    if (n) citado[rel] = n
    const escritas = escritasNaTrava(fonte)
    if (escritas.length) achado[rel] = escritas
    const updates = atualizacoesNaTrava(fonte)
    if (updates.length) atualizado[rel] = updates
  }

  it('DEFAULT-DENY: o conjunto de arquivos que citam a tabela, e quantas vezes, é EXATO', () => {
    expect(citado).toEqual(CITACOES)
  })

  it('UPDATE que mexe na chave também passa por chaveDaTrava', () => {
    for (const [arquivo, payloads] of Object.entries(atualizado)) {
      for (const payload of payloads) {
        if (/(?<![\w])['"]?valor['"]?\s*:/.test(payload)) {
          expect(gravaPeloInstante(payload), `${arquivo}: ${payload}`).toBe(true)
        }
      }
    }
  })

  it('o conjunto de escritores é EXATO', () => {
    expect(Object.fromEntries(Object.entries(achado).map(([k, v]) => [k, v.length]))).toEqual(
      ESCRITORES,
    )
  })

  for (const arquivo of Object.keys(ESCRITORES)) {
    it(`${arquivo} passa o valor por chaveDaTrava`, () => {
      for (const payload of achado[arquivo] ?? []) {
        expect(gravaPeloInstante(payload), payload).toBe(true)
      }
    })
  }

  it('o scanner enxerga a escrita e reprova o valor cru', () => {
    const cru = semComentarios(
      `await db.from('cb_automation_reminders').insert({ contact_id: c, valor: alvo.valor, motivo: 'disparo' })`,
    )
    const certo = semComentarios(
      `await db.from("cb_automation_reminders").upsert(alvos.map((a) => ({\n  valor: chaveDaTrava(a.valor),\n})), { onConflict: "automation_id,contact_id,valor" })`,
    )
    expect(escritasNaTrava(cru)).toHaveLength(1)
    expect(gravaPeloInstante(escritasNaTrava(cru)[0])).toBe(false)
    expect(escritasNaTrava(certo)).toHaveLength(1)
    expect(gravaPeloInstante(escritasNaTrava(certo)[0])).toBe(true)
    // `.delete()` (a devolução e a poda) não é escrita de chave
    expect(escritasNaTrava(`db.from('cb_automation_reminders').delete().eq('id', id)`)).toEqual([])
    // payload sem `valor` nenhum também reprova
    expect(gravaPeloInstante('{ contact_id: c }')).toBe(false)
    // as formas que a regex das escritas NÃO vê são pegas pela contagem
    expect(citacoes(`const t = db.from('cb_automation_reminders'); await t.insert({ valor: v })`)).toBe(1)
    expect(citacoes(`const T = "cb_automation_reminders"; db.from(T).insert({ valor: v })`)).toBe(1)
    expect(
      atualizacoesNaTrava(`db.from('cb_automation_reminders').update({ valor: alvo.valor })`),
    ).toHaveLength(1)
  })
})
