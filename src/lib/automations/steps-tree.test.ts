import { beforeEach, describe, expect, it, vi } from 'vitest'

// ============================================================
// Salvar a automação PRESERVA a identidade dos passos (26/09/2026).
//
// Até aqui `replaceSteps` apagava todos os passos e reinseria com ids novos: a
// espera parada num ramo perdia o `parent_step_id` (FK `ON DELETE SET NULL`) e
// a retomada rodava o escopo de fora. O banco falso aplica as duas FKs que
// apontam para `automation_steps`: a CASCADE dos ramos e o SET NULL da fila.
// ============================================================

type Linha = Record<string, unknown>

const h = vi.hoisted(() => ({
  passos: [] as Linha[],
  fila: [] as Linha[],
  /** A ordem das escritas — o DELETE vem antes do upsert (ver `replaceSteps`). */
  ops: [] as string[],
  erro: {} as Partial<Record<'select' | 'delete' | 'upsert' | 'insert', string>>,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (tabela: string) => {
      expect(tabela).toBe('automation_steps')
      let op: 'select' | 'delete' | 'upsert' | 'insert' = 'select'
      let payload: Linha[] = []
      const filtros: [string, string, unknown][] = []
      const b: Record<string, unknown> = {
        select: () => b,
        delete: () => ((op = 'delete'), b),
        upsert: (p: Linha[], o?: { onConflict?: string }) => {
          expect(o?.onConflict).toBe('id')
          op = 'upsert'
          payload = p
          return b
        },
        insert: (p: Linha[]) => ((op = 'insert'), (payload = p), b),
        eq: (k: string, v: unknown) => (filtros.push(['eq', k, v]), b),
        in: (k: string, v: unknown) => (filtros.push(['in', k, v]), b),
        not: (k: string, o: string, v: unknown) => (filtros.push([`not.${o}`, k, v]), b),
        order: () => b,
        then: (f: (v: unknown) => unknown) => {
          h.ops.push(op)
          if (h.erro[op]) return Promise.resolve({ data: null, error: { message: h.erro[op] } }).then(f)
          let r: unknown = { data: null, error: null }
          if (op === 'select') {
            const ids = filtros.find(([o, k]) => o === 'in' && k === 'id')?.[2] as string[] | undefined
            const iguais = filtros.filter(([o]) => o === 'eq')
            r = {
              data: h.passos.filter(
                (p) => (!ids || ids.includes(p.id as string)) && iguais.every(([, k, v]) => p[k] === v),
              ),
              error: null,
            }
          } else if (op === 'delete') {
            const conta = filtros.find(([o, k]) => o === 'eq' && k === 'automation_id')?.[2]
            const fora = String(filtros.find(([o]) => o === 'not.in')?.[2] ?? '()')
              .slice(1, -1)
              .split(',')
              .filter(Boolean)
            const apagados = new Set(
              h.passos.filter((p) => p.automation_id === conta && !fora.includes(p.id as string)).map((p) => p.id),
            )
            // CASCADE de `automation_steps.parent_step_id`.
            for (let cresceu = true; cresceu; ) {
              cresceu = false
              for (const p of h.passos) {
                if (apagados.has(p.parent_step_id) && !apagados.has(p.id)) {
                  apagados.add(p.id)
                  cresceu = true
                }
              }
            }
            h.passos = h.passos.filter((p) => !apagados.has(p.id))
            // SET NULL de `automation_pending_executions.parent_step_id`.
            for (const e of h.fila) if (apagados.has(e.parent_step_id)) e.parent_step_id = null
          } else if (op === 'upsert') {
            for (const linha of payload) {
              const i = h.passos.findIndex((p) => p.id === linha.id)
              if (i >= 0) h.passos[i] = { ...h.passos[i], ...linha }
              else h.passos.push({ ...linha })
            }
          } else {
            for (const linha of payload) {
              if (h.passos.some((p) => p.id === linha.id)) {
                const erro = { message: 'duplicate key value violates unique constraint "automation_steps_pkey"' }
                return Promise.resolve({ data: null, error: erro }).then(f)
              }
            }
            h.passos.push(...payload)
          }
          return Promise.resolve(r).then(f)
        },
      }
      return b
    },
  }),
}))

import { insertSteps, loadStepsTree, montarLinhas, replaceSteps, type BuilderStepInput } from './steps-tree'

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COND = uuid(1)
const ESPERA = uuid(2)
const NO_RAMO = uuid(3)
const DE_FORA = uuid(4)
const ALHEIO = uuid(9)

const passo = (id: string, step_type: string, position: number, parent: string | null, automation_id = 'auto-1'): Linha => ({
  id,
  automation_id,
  parent_step_id: parent,
  branch: parent ? 'yes' : null,
  step_type,
  step_config: { v: id },
  position,
})

beforeEach(() => {
  h.passos = [
    passo(COND, 'condition', 0, null),
    passo(ESPERA, 'wait', 0, COND),
    passo(NO_RAMO, 'send_message', 1, COND),
    passo(DE_FORA, 'send_message', 1, null),
    passo(ALHEIO, 'send_message', 0, null, 'auto-de-outra-conta'),
  ]
  h.fila = [{ id: 'espera-1', parent_step_id: COND, branch: 'yes' }]
  h.ops = []
  h.erro = {}
})

const arvore = async () => (await loadStepsTree('auto-1')) as BuilderStepInput[]
const idsDe = (automacao: string) =>
  h.passos.filter((p) => p.automation_id === automacao).map((p) => p.id).sort()

describe('replaceSteps — a identidade dos passos', () => {
  it('CRÍTICO: salvar a mesma árvore (com os ids do GET) não muda id nenhum, e a espera do ramo guarda a condição', async () => {
    const antes = idsDe('auto-1')
    expect(await replaceSteps('auto-1', await arvore())).toBeNull()
    expect(idsDe('auto-1')).toEqual(antes)
    expect(h.fila[0].parent_step_id).toBe(COND)
  })

  it('passo NOVO no começo do ramo: entra com id novo, os outros ficam e são reposicionados no lugar', async () => {
    const a = await arvore()
    a[0].branches!.yes!.unshift({ step_type: 'send_message', step_config: { text: 'novo' } })
    a[0].branches!.yes![2].step_config = { text: 'editado' }
    expect(await replaceSteps('auto-1', a)).toBeNull()

    expect(h.fila[0].parent_step_id).toBe(COND)
    const doRamo = h.passos
      .filter((p) => p.parent_step_id === COND)
      .sort((x, y) => (x.position as number) - (y.position as number))
    expect(doRamo.map((p) => p.step_config)).toEqual([{ text: 'novo' }, { v: ESPERA }, { text: 'editado' }])
    expect(doRamo[1].id).toBe(ESPERA)
    expect(doRamo[2].id).toBe(NO_RAMO)
  })

  it('remover UM passo apaga só ele', async () => {
    const a = await arvore()
    a.splice(1, 1) // "de fora"
    expect(await replaceSteps('auto-1', a)).toBeNull()
    expect(idsDe('auto-1')).toEqual([COND, ESPERA, NO_RAMO].sort())
  })

  it('remover a CONDIÇÃO leva os passos do ramo (CASCADE) e zera o pai da espera (SET NULL) — a retomada a trata como órfã', async () => {
    const a = await arvore()
    a.splice(0, 1)
    expect(await replaceSteps('auto-1', a)).toBeNull()
    expect(idsDe('auto-1')).toEqual([DE_FORA])
    expect(h.fila[0]).toMatchObject({ parent_step_id: null, branch: 'yes' })
  })

  it('⚠️ APAGA antes de gravar — o passo removido nunca convive com a versão nova', async () => {
    const a = await arvore()
    a.splice(1, 1)
    h.ops = []
    await replaceSteps('auto-1', a)
    expect(h.ops).toEqual(['select', 'delete', 'upsert'])
  })

  it('⚠️⚠️ id de passo de OUTRA automação nunca é aproveitado: o passo alheio fica intacto', async () => {
    const a = await arvore()
    a.push({ id: ALHEIO, step_type: 'send_message', step_config: { text: 'invasão' } })
    expect(await replaceSteps('auto-1', a)).toBeNull()

    expect(h.passos.find((p) => p.id === ALHEIO)).toMatchObject({
      automation_id: 'auto-de-outra-conta',
      step_config: { v: ALHEIO },
    })
    const novo = h.passos.find((p) => p.automation_id === 'auto-1' && (p.step_config as Linha).text === 'invasão')
    expect(novo?.id).not.toBe(ALHEIO)
  })

  it('lista vazia apaga tudo desta automação, sem upsert', async () => {
    h.ops = []
    expect(await replaceSteps('auto-1', [])).toBeNull()
    expect(idsDe('auto-1')).toEqual([])
    expect(idsDe('auto-de-outra-conta')).toEqual([ALHEIO])
    expect(h.ops).toEqual(['delete'])
  })

  it('erro na leitura ou no DELETE devolve a mensagem e NÃO grava nada', async () => {
    const a = await arvore()
    h.erro.select = 'timeout'
    h.ops = []
    expect(await replaceSteps('auto-1', a)).toBe('timeout')
    expect(h.ops).toEqual(['select'])

    h.erro = { delete: 'recusado' }
    h.ops = []
    expect(await replaceSteps('auto-1', a)).toBe('recusado')
    expect(h.ops).toEqual(['select', 'delete'])
  })
})

describe('montarLinhas — que id fica', () => {
  it('id sem forma de UUID, ou repetido no payload, vira id novo', () => {
    const linhas = montarLinhas('auto-1', [
      { id: 'c_nao-e-uuid', step_type: 'send_message', step_config: {} },
      { id: ESPERA, step_type: 'wait', step_config: {} },
      { id: ESPERA, step_type: 'wait', step_config: {} },
    ])
    expect(linhas[0].id).not.toBe('c_nao-e-uuid')
    expect(linhas[1].id).toBe(ESPERA)
    expect(linhas[2].id).not.toBe(ESPERA)
    expect(new Set(linhas.map((l) => l.id)).size).toBe(3)
  })

  it('UUID em maiúsculas é guardado em minúsculas (a forma que o Postgres devolve)', () => {
    expect(montarLinhas('a', [{ id: ESPERA.toUpperCase(), step_type: 'wait', step_config: {} }])[0].id).toBe(ESPERA)
  })

  it('os filhos apontam para o id FINAL do pai, e a posição é a do escopo', () => {
    const [cond, sim, nao] = montarLinhas('a', [
      {
        step_type: 'condition',
        step_config: {},
        branches: { yes: [{ step_type: 'wait', step_config: {} }], no: [{ step_type: 'wait', step_config: {} }] },
      },
    ])
    expect(sim).toMatchObject({ parent_step_id: cond.id, branch: 'yes', position: 0 })
    expect(nao).toMatchObject({ parent_step_id: cond.id, branch: 'no', position: 0 })
  })
})

describe('insertSteps — automação recém-criada', () => {
  it('ids sempre NOVOS (o construtor recarrega depois de criar); o passo alheio fica intacto', async () => {
    expect(await insertSteps('auto-nova', [{ id: ALHEIO, step_type: 'send_message', step_config: {} }])).toBeNull()
    expect(h.passos.find((p) => p.id === ALHEIO)?.automation_id).toBe('auto-de-outra-conta')
    expect(idsDe('auto-nova')).toHaveLength(1)
    expect(idsDe('auto-nova')[0]).not.toBe(ALHEIO)
  })
})
